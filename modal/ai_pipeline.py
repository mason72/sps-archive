"""
SPS Archive — AI Processing Pipeline (Modal Serverless GPU)

Processes uploaded images through:
  1. CLIP embedding generation (semantic search)
  2. ArcFace face detection + embedding (face clustering)
  3. Aesthetic/quality scoring (smart stack ranking)
  4. Zero-shot scene classification (auto-sections)

Deploy: modal deploy modal/ai_pipeline.py
Test:   modal run modal/ai_pipeline.py
"""

import modal
import io
import numpy as np
from typing import Optional

# ---------------------------------------------------------------------------
# Modal App + Image
# ---------------------------------------------------------------------------
app = modal.App("sps-archive-ai")

ai_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch==2.5.1",
        "torchvision==0.20.1",
        "transformers==4.47.0",
        "insightface==0.7.3",
        "onnxruntime-gpu==1.20.0",
        "opencv-python-headless==4.10.0.84",
        "pillow==11.0.0",
        "numpy==1.26.4",
        "httpx==0.28.0",
    )
    .run_commands("pip install open_clip_torch==2.29.0")
)

# ---------------------------------------------------------------------------
# Model loading (cached across warm instances)
# ---------------------------------------------------------------------------
@app.cls(
    image=ai_image,
    gpu="T4",  # Cheapest GPU, sufficient for inference
    timeout=300,
    container_idle_timeout=60,  # Keep warm for 60s between calls
    allow_concurrent_inputs=4,  # Process multiple images per container
)
class ImageProcessor:
    @modal.enter()
    def load_models(self):
        """Load all models once when container starts."""
        import torch
        import open_clip
        from insightface.app import FaceAnalysis

        self.device = "cuda" if torch.cuda.is_available() else "cpu"

        # CLIP model for semantic embeddings
        self.clip_model, _, self.clip_preprocess = open_clip.create_model_and_transforms(
            "ViT-L-14", pretrained="datacomp_xl_s13b_b90k"
        )
        self.clip_model = self.clip_model.to(self.device).eval()
        self.clip_tokenizer = open_clip.get_tokenizer("ViT-L-14")

        # Scene classification prompts (pre-tokenized)
        scene_labels = [
            "ceremony", "reception", "first dance", "speeches", "getting ready",
            "bridal party", "cake cutting", "bouquet toss", "first look",
            "group photo", "candid moment", "portrait", "detail shot",
            "landscape", "food", "venue", "decoration", "headshot",
            "presentation", "networking", "panel discussion",
            "outdoor", "indoor", "night", "golden hour",
        ]
        self.scene_prompts = [f"a photo of {label}" for label in scene_labels]
        self.scene_labels = scene_labels
        self.scene_tokens = self.clip_tokenizer(self.scene_prompts).to(self.device)

        with torch.no_grad():
            self.scene_text_features = self.clip_model.encode_text(self.scene_tokens)
            self.scene_text_features /= self.scene_text_features.norm(dim=-1, keepdim=True)

        # ArcFace model for face detection + embedding
        self.face_app = FaceAnalysis(
            name="buffalo_l",
            providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
        )
        self.face_app.prepare(ctx_id=0, det_size=(640, 640))

        print("All models loaded successfully")

    @modal.method()
    def process_image(self, image_url: str, image_id: str, event_id: str) -> dict:
        """Process a single image through the full AI pipeline."""
        import httpx
        from PIL import Image
        import torch
        import cv2

        # Download image
        response = httpx.get(image_url, timeout=60)
        response.raise_for_status()
        image_bytes = response.content

        pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        cv_image = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)

        # 1. CLIP embedding + scene classification
        clip_result = self._generate_clip_embedding(pil_image)

        # 2. Face detection + ArcFace embeddings
        face_result = self._detect_faces(cv_image, image_id)

        # 3. Aesthetic scoring
        aesthetic_result = self._score_aesthetics(pil_image, cv_image)

        return {
            "imageId": image_id,
            "eventId": event_id,
            "clip": {
                "imageId": image_id,
                "embedding": clip_result["embedding"],
                "sceneTags": clip_result["scene_tags"],
            },
            "faces": {
                "imageId": image_id,
                "faces": face_result,
            },
            "aesthetic": {
                "imageId": image_id,
                "aestheticScore": aesthetic_result["aesthetic_score"],
                "sharpnessScore": aesthetic_result["sharpness_score"],
                "exposureScore": aesthetic_result["exposure_score"],
            },
        }

    @modal.method()
    def embed_text(self, text: str) -> dict:
        """Generate CLIP embedding for a text query (used for semantic search)."""
        import torch

        tokens = self.clip_tokenizer([text]).to(self.device)

        with torch.no_grad():
            text_features = self.clip_model.encode_text(tokens)
            text_features /= text_features.norm(dim=-1, keepdim=True)

        return {
            "embedding": text_features[0].cpu().numpy().tolist(),
        }

    def _generate_clip_embedding(self, pil_image) -> dict:
        """Generate CLIP image embedding and classify scenes."""
        import torch

        image_tensor = self.clip_preprocess(pil_image).unsqueeze(0).to(self.device)

        with torch.no_grad():
            image_features = self.clip_model.encode_image(image_tensor)
            image_features /= image_features.norm(dim=-1, keepdim=True)

            # Scene classification via cosine similarity
            similarities = (image_features @ self.scene_text_features.T).squeeze(0)
            probs = similarities.softmax(dim=-1)

        embedding = image_features[0].cpu().numpy().tolist()

        # Top scene tags (above threshold)
        threshold = 0.08
        top_indices = (probs > threshold).nonzero(as_tuple=True)[0]
        scene_tags = [
            self.scene_labels[i]
            .replace(" ", "-")
            for i in top_indices.cpu().numpy()
        ]

        # Always include top-1 even if below threshold
        if not scene_tags:
            top_idx = probs.argmax().item()
            scene_tags = [self.scene_labels[top_idx].replace(" ", "-")]

        return {"embedding": embedding, "scene_tags": scene_tags}

    def _detect_faces(self, cv_image, image_id: str) -> list:
        """Detect faces and generate ArcFace embeddings."""
        h, w = cv_image.shape[:2]
        faces = self.face_app.get(cv_image)

        results = []
        for face in faces:
            bbox = face.bbox.astype(float)

            # Normalize bounding box to 0-1
            x1, y1, x2, y2 = bbox
            normalized_bbox = {
                "x": float(x1 / w),
                "y": float(y1 / h),
                "w": float((x2 - x1) / w),
                "h": float((y2 - y1) / h),
            }

            # Check if eyes are open (using landmarks)
            is_eyes_open = True
            if face.landmark_2d_106 is not None:
                # Use eye aspect ratio heuristic
                is_eyes_open = self._check_eyes_open(face.landmark_2d_106)

            # Face quality score based on detection confidence and size
            face_size = normalized_bbox["w"] * normalized_bbox["h"]
            quality = float(face.det_score) * min(1.0, face_size * 20)

            results.append({
                "bbox": normalized_bbox,
                "embedding": face.embedding.tolist() if face.embedding is not None else None,
                "isEyesOpen": is_eyes_open,
                "quality": quality,
            })

        return results

    def _check_eyes_open(self, landmarks) -> bool:
        """Heuristic check for open eyes using facial landmarks."""
        # landmarks_2d_106: indices 33-42 = left eye, 87-96 = right eye
        try:
            left_eye = landmarks[33:43]
            right_eye = landmarks[87:97]

            left_ear = self._eye_aspect_ratio(left_eye)
            right_ear = self._eye_aspect_ratio(right_eye)

            avg_ear = (left_ear + right_ear) / 2
            return avg_ear > 0.15  # Threshold for open eyes
        except (IndexError, ValueError):
            return True  # Assume open if we can't determine

    @staticmethod
    def _eye_aspect_ratio(eye_points) -> float:
        """Calculate eye aspect ratio (EAR)."""
        if len(eye_points) < 6:
            return 0.3  # Default to "open"

        # Vertical distances
        v1 = np.linalg.norm(eye_points[1] - eye_points[5])
        v2 = np.linalg.norm(eye_points[2] - eye_points[4])
        # Horizontal distance
        h = np.linalg.norm(eye_points[0] - eye_points[3])

        if h == 0:
            return 0.3
        return (v1 + v2) / (2.0 * h)

    def _score_aesthetics(self, pil_image, cv_image) -> dict:
        """Score image quality: sharpness, exposure, overall aesthetic."""
        import cv2

        gray = cv2.cvtColor(cv_image, cv2.COLOR_BGR2GRAY)

        # Sharpness via Laplacian variance
        laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
        sharpness = min(1.0, laplacian_var / 1000.0)

        # Exposure score (histogram analysis)
        hist = cv2.calcHist([gray], [0], None, [256], [0, 256])
        hist = hist.flatten() / hist.sum()

        # Penalize extreme under/over exposure
        dark_ratio = hist[:30].sum()
        bright_ratio = hist[225:].sum()
        mid_ratio = hist[60:200].sum()
        exposure = min(1.0, mid_ratio * 1.5) * (1 - max(0, dark_ratio - 0.3)) * (1 - max(0, bright_ratio - 0.3))
        exposure = max(0.0, min(1.0, exposure))

        # Combined aesthetic score
        aesthetic = sharpness * 0.5 + exposure * 0.3 + 0.2  # Base 0.2 for being a valid image

        return {
            "sharpness_score": round(sharpness, 4),
            "exposure_score": round(exposure, 4),
            "aesthetic_score": round(min(1.0, aesthetic), 4),
        }


# ---------------------------------------------------------------------------
# Web endpoints (called from Next.js via HTTP)
# ---------------------------------------------------------------------------
@app.function(image=ai_image, gpu="T4", timeout=300)
@modal.web_endpoint(method="POST")
def process_image(item: dict) -> dict:
    """HTTP endpoint: process a single image."""
    processor = ImageProcessor()
    return processor.process_image.remote(
        image_url=item["image_url"],
        image_id=item["image_id"],
        event_id=item["event_id"],
    )


@app.function(image=ai_image, gpu="T4", timeout=60)
@modal.web_endpoint(method="POST")
def embed_text(item: dict) -> dict:
    """HTTP endpoint: generate text embedding for search."""
    processor = ImageProcessor()
    return processor.embed_text.remote(text=item["text"])


# ---------------------------------------------------------------------------
# Batch processing (for bulk uploads)
# ---------------------------------------------------------------------------
@app.function(image=ai_image, gpu="T4", timeout=600)
def process_batch(items: list[dict]) -> list[dict]:
    """Process a batch of images. Called via Modal .map() for parallelism."""
    processor = ImageProcessor()
    results = []
    for item in items:
        try:
            result = processor.process_image.remote(
                image_url=item["image_url"],
                image_id=item["image_id"],
                event_id=item["event_id"],
            )
            results.append(result)
        except Exception as e:
            results.append({
                "imageId": item["image_id"],
                "error": str(e),
            })
    return results
