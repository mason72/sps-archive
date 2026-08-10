"""
Pixeltrunk — AI Indexing Pipeline v2 (Modal serverless GPU)

Rebuilt from scratch 2026-08-09 (the v1 prototype in this file's history was
never deployed: unauthenticated endpoints, double-GPU dispatch, no baked
weights, broken scene-tag softmax). See tasks/todo.md "AI revival".

One batched pass per image produces:
  1. SigLIP-2 image embedding (1152-dim) — semantic search, and suggest-time
     scene classification (labels are classified in TS against these vectors;
     nothing taxonomy-shaped is computed or persisted here)
  2. ArcFace face detection + 512-dim embeddings — clustering, selfie search
  3. Quality signals — learned aesthetic score (aesthetic-predictor-v2.5),
     Laplacian sharpness, best-effort eyes-open (advisory until validated)

Design rules (from the 2026-06-01 shutdown post-mortem):
  - Pure compute: no Supabase/R2 credentials. The payload carries presigned
    thumb-lg GET URLs (800px is plenty for every model here — never
    originals); all persistence happens in Next.js.
  - Auth: shared pipeline_key, same secret as the face/video pipelines.
  - Batched (≤100 images/call) with per-image error isolation.
  - Weights baked into the image at build time — no cold-start downloads.

Endpoints:
  index_images (GPU)  {pipeline_key, images: [{id, url}]} →
                      {ok, results: {id: {...}}, errors: {id: msg}}
  embed_text   (CPU)  {pipeline_key, texts: [..]} → {ok, embeddings: [[..]]}
                      (text tower only — cheap enough to answer search
                      queries without spinning a GPU)

Deploy: ~/.venvs/modal-cli/bin/modal deploy modal/ai_pipeline.py
"""

import modal

app = modal.App("sps-archive-ai")

SIGLIP2_MODEL = "google/siglip2-so400m-patch16-384"
EMBED_DIM = 1152
MAX_BATCH = 100

gpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch==2.5.1",
        "torchvision==0.20.1",
        "transformers==4.49.0",
        "insightface==0.7.3",
        "onnxruntime-gpu==1.20.0",
        "opencv-python-headless==4.10.0.84",
        "pillow==11.0.0",
        "numpy==1.26.4",
        "httpx==0.28.0",
        "fastapi[standard]",
        "aesthetic-predictor-v2-5",
        "sentencepiece==0.2.0",
        "protobuf",
    )
    # Bake every model into the image so cold starts never download weights.
    # AutoImageProcessor, NOT AutoProcessor: SiglipProcessor hardcodes its
    # sentencepiece tokenizer and crashes on SigLIP-2's Gemma tokenizer; the
    # GPU side never tokenizes text anyway (embed_text is the CPU function).
    .run_commands(
        "python -c \"from transformers import AutoModel, AutoImageProcessor; "
        f"AutoModel.from_pretrained('{SIGLIP2_MODEL}'); "
        f"AutoImageProcessor.from_pretrained('{SIGLIP2_MODEL}')\"",
        "python -c \"from insightface.app import FaceAnalysis; "
        "FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider'])\"",
        "python -c \"from aesthetic_predictor_v2_5 import convert_v2_5_from_siglip; "
        "convert_v2_5_from_siglip(low_cpu_mem_usage=True, trust_remote_code=True)\"",
    )
)

text_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch==2.5.1",
        "transformers==4.49.0",
        "numpy==1.26.4",
        "fastapi[standard]",
        "sentencepiece==0.2.0",
        "protobuf",
    )
    # Fixed-res SigLIP-2 checkpoints ship model_type "siglip", so the text
    # tower loads through the original SiglipTextModel class.
    .run_commands(
        "python -c \"from transformers import SiglipTextModel, AutoTokenizer; "
        f"SiglipTextModel.from_pretrained('{SIGLIP2_MODEL}'); "
        f"AutoTokenizer.from_pretrained('{SIGLIP2_MODEL}')\""
    )
)


def _check_key(payload: dict):
    import os

    from fastapi import HTTPException

    expected = os.environ.get("VIDEO_PIPELINE_KEY")
    if expected and payload.get("pipeline_key") != expected:
        raise HTTPException(status_code=401, detail="bad pipeline_key")


@app.cls(
    image=gpu_image,
    gpu="T4",
    timeout=600,
    scaledown_window=120,
    secrets=[modal.Secret.from_name("video-pipeline")],
)
@modal.concurrent(max_inputs=1)  # one batch per container; scale by containers
class AIIndexer:
    @modal.enter()
    def load(self):
        import torch
        from aesthetic_predictor_v2_5 import convert_v2_5_from_siglip
        from insightface.app import FaceAnalysis
        from transformers import AutoImageProcessor, AutoModel

        self.device = "cuda" if torch.cuda.is_available() else "cpu"

        self.siglip = AutoModel.from_pretrained(SIGLIP2_MODEL).to(self.device).eval()
        self.processor = AutoImageProcessor.from_pretrained(SIGLIP2_MODEL)

        self.aesthetic, self.aesthetic_preprocessor = convert_v2_5_from_siglip(
            low_cpu_mem_usage=True, trust_remote_code=True
        )
        self.aesthetic = self.aesthetic.to(self.device).eval()

        self.face_app = FaceAnalysis(
            name="buffalo_l",
            providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
        )
        self.face_app.prepare(ctx_id=0, det_size=(640, 640))
        print("models loaded")

    @modal.fastapi_endpoint(method="POST")
    def embed_selfie(self, payload: dict) -> dict:
        """
        Guest selfie → face embeddings, statelessly: the image arrives as
        base64 in the request, is embedded in memory, and is never written
        anywhere. {pipeline_key, image_b64} → {ok, faces: [{bbox, embedding,
        quality}]} (same face contract as index_images, minus eyes).
        """
        import base64

        from fastapi import HTTPException

        _check_key(payload)
        b64 = payload.get("image_b64") or ""
        if not b64 or len(b64) > 8_000_000:  # ~6MB decoded ceiling
            raise HTTPException(status_code=400, detail="image_b64 required, ≤6MB")
        try:
            pil = self._decode(base64.b64decode(b64))
        except Exception:
            raise HTTPException(status_code=400, detail="not a decodable image")
        faces = self._faces(pil)
        for f in faces:
            f.pop("eyesOpen", None)
        return {"ok": True, "faces": faces}

    @modal.fastapi_endpoint(method="POST")
    def index_images(self, payload: dict) -> dict:
        import httpx
        import numpy as np
        from fastapi import HTTPException

        _check_key(payload)
        images = payload.get("images") or []
        if len(images) > MAX_BATCH:
            raise HTTPException(status_code=400, detail=f"max {MAX_BATCH} images per call")

        # Download phase — per-image isolation, failures never sink the batch.
        loaded = []
        errors: dict = {}
        with httpx.Client(timeout=30, follow_redirects=True) as client:
            for item in images:
                image_id, url = item.get("id"), item.get("url")
                if not image_id or not url:
                    continue
                try:
                    resp = client.get(url)
                    resp.raise_for_status()
                    pil = self._decode(resp.content)
                    loaded.append((image_id, pil))
                except Exception as exc:
                    errors[image_id] = str(exc)[:200]

        results: dict = {}
        pils = [pil for _, pil in loaded]
        embeddings = self._embed_images(pils)
        aesthetics = self._score_aesthetics(pils)

        for i, (image_id, pil) in enumerate(loaded):
            try:
                results[image_id] = {
                    "embedding": embeddings[i],
                    "aestheticScore": aesthetics[i],
                    "sharpnessScore": self._sharpness(pil),
                    "faces": self._faces(pil),
                }
            except Exception as exc:
                errors[image_id] = str(exc)[:200]

        return {"ok": True, "model": SIGLIP2_MODEL, "results": results, "errors": errors}

    @staticmethod
    def _decode(data: bytes):
        import io

        from PIL import Image

        return Image.open(io.BytesIO(data)).convert("RGB")

    def _embed_images(self, pils, chunk=16) -> list:
        import torch

        out: list = []
        for start in range(0, len(pils), chunk):
            batch = pils[start : start + chunk]
            inputs = self.processor(images=batch, return_tensors="pt").to(self.device)
            with torch.no_grad():
                feats = self.siglip.get_image_features(**inputs)
                feats = feats / feats.norm(dim=-1, keepdim=True)
            out.extend([f.cpu().float().numpy().tolist() for f in feats])
        return out

    def _score_aesthetics(self, pils, chunk=8) -> list:
        """aesthetic-predictor-v2.5: human-preference score ~1-10 → 0-1."""
        import torch

        out: list = []
        for start in range(0, len(pils), chunk):
            batch = pils[start : start + chunk]
            inputs = self.aesthetic_preprocessor(images=batch, return_tensors="pt").to(self.device)
            with torch.no_grad():
                logits = self.aesthetic(**inputs).logits.squeeze(-1).float()
            out.extend([round(min(1.0, max(0.0, s / 10.0)), 4) for s in logits.cpu().tolist()])
        return out

    @staticmethod
    def _sharpness(pil) -> float:
        import cv2
        import numpy as np

        gray = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2GRAY)
        return round(min(1.0, cv2.Laplacian(gray, cv2.CV_64F).var() / 1000.0), 4)

    def _faces(self, pil) -> list:
        import cv2
        import numpy as np

        cv_image = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
        h, w = cv_image.shape[:2]
        results = []
        for face in self.face_app.get(cv_image):
            x1, y1, x2, y2 = face.bbox.astype(float)
            box = {
                "x": float(x1 / w),
                "y": float(y1 / h),
                "w": float((x2 - x1) / w),
                "h": float((y2 - y1) / h),
            }
            # Same formula as face_pipeline.py / the focal-point rows.
            quality = float(face.det_score) * min(1.0, box["w"] * box["h"] * 20)
            embedding = None
            if face.embedding is not None:
                emb = np.asarray(face.embedding, dtype=np.float64)
                norm = np.linalg.norm(emb)
                if norm > 0:
                    embedding = (emb / norm).tolist()
            results.append(
                {
                    "bbox": box,
                    "embedding": embedding,
                    "quality": quality,
                    # Advisory until validated against real blink photos —
                    # landmark ordering for the 106-pt model is unverified.
                    "eyesOpen": self._eyes_open(face),
                }
            )
        return results

    @staticmethod
    def _eyes_open(face):
        import numpy as np

        lmk = getattr(face, "landmark_2d_106", None)
        if lmk is None:
            return None
        try:
            def ear(pts):
                v1 = np.linalg.norm(pts[1] - pts[5])
                v2 = np.linalg.norm(pts[2] - pts[4])
                hd = np.linalg.norm(pts[0] - pts[3])
                return (v1 + v2) / (2.0 * hd) if hd > 0 else None

            ears = [ear(lmk[33:39]), ear(lmk[87:93])]
            ears = [e for e in ears if e is not None]
            return bool(sum(ears) / len(ears) > 0.15) if ears else None
        except (IndexError, ValueError, ZeroDivisionError):
            return None


@app.function(
    image=text_image,
    memory=6144,
    timeout=60,
    scaledown_window=300,
    secrets=[modal.Secret.from_name("video-pipeline")],
)
@modal.fastapi_endpoint(method="POST")
def embed_text(payload: dict) -> dict:
    """Text tower only, on CPU — search queries never wait on a GPU."""
    import torch
    from fastapi import HTTPException

    global _text_model, _tokenizer
    _check_key(payload)

    texts = payload.get("texts") or []
    if not texts or len(texts) > 64:
        raise HTTPException(status_code=400, detail="1-64 texts per call")

    try:
        _text_model
    except NameError:
        from transformers import AutoTokenizer, SiglipTextModel

        _text_model = SiglipTextModel.from_pretrained(SIGLIP2_MODEL).eval()
        _tokenizer = AutoTokenizer.from_pretrained(SIGLIP2_MODEL)

    inputs = _tokenizer(
        texts, padding="max_length", max_length=64, truncation=True, return_tensors="pt"
    )
    with torch.no_grad():
        feats = _text_model(**inputs).pooler_output
        feats = feats / feats.norm(dim=-1, keepdim=True)

    return {
        "ok": True,
        "model": SIGLIP2_MODEL,
        "embeddings": [f.numpy().tolist() for f in feats.float()],
    }
