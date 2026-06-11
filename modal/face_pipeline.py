"""
Pixeltrunk — On-demand Face Detection (Modal, CPU)

Detection-only successor to the shelved AI pipeline's ArcFace step, kept
alive for exactly one feature: focal-point suggestions. The editor's bulk
"Suggest all" calls this for images that have never been scanned, writes the
boxes into the `faces` table, and the existing single-confident-face rule
(src/lib/site/focal.ts) turns them into eye-level focal points.

Detection only — no embeddings, no clustering, no status writes (the side
effects that got the original pipeline shelved). Quality matches the old
formula exactly: det_score × min(1, area × 20).

Credential-free like the video pipeline: the payload carries presigned GET
URLs (800px thumbnails are plenty for SCRFD detection) and the shared
`video-pipeline` secret's VIDEO_PIPELINE_KEY.

Deploy: modal deploy modal/face_pipeline.py
"""

import modal

app = modal.App("sps-archive-faces")

face_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "insightface==0.7.3",
        "onnxruntime==1.20.0",
        "opencv-python-headless==4.10.0.84",
        "numpy==1.26.4",
        "httpx==0.28.0",
        "fastapi[standard]",
    )
    # Bake the detection model into the image so cold starts skip the download.
    .run_commands(
        "python -c \"from insightface.app import FaceAnalysis; "
        "FaceAnalysis(name='buffalo_l', allowed_modules=['detection'], "
        "providers=['CPUExecutionProvider'])\""
    )
)

# Container-lifetime model cache (one load per warm container).
_detector = None


def _get_detector():
    global _detector
    if _detector is None:
        from insightface.app import FaceAnalysis

        _detector = FaceAnalysis(
            name="buffalo_l",
            allowed_modules=["detection"],
            providers=["CPUExecutionProvider"],
        )
        _detector.prepare(ctx_id=-1, det_size=(640, 640))
    return _detector


@app.function(
    image=face_image,
    timeout=300,
    memory=2048,
    scaledown_window=120,
    secrets=[modal.Secret.from_name("video-pipeline")],
)
@modal.fastapi_endpoint(method="POST")
def detect_faces(payload: dict):
    """
    Input JSON:
      {
        "pipeline_key": shared secret (must match VIDEO_PIPELINE_KEY),
        "images": [{"id": "...", "url": "<presigned GET>"}, ...]   # max 200
      }

    Returns:
      {
        "ok": true,
        "faces": { "<id>": [{"x","y","w","h","quality"}, ...], ... },
        "errors": { "<id>": "message", ... }   # per-image failures
      }
    Boxes are normalized 0-1, matching the faces table contract.
    """
    import os

    import cv2
    import httpx
    import numpy as np
    from fastapi import HTTPException

    expected = os.environ.get("VIDEO_PIPELINE_KEY")
    if expected and payload.get("pipeline_key") != expected:
        raise HTTPException(status_code=401, detail="bad pipeline_key")

    images = payload.get("images") or []
    if len(images) > 200:
        raise HTTPException(status_code=400, detail="max 200 images per call")

    detector = _get_detector()
    faces_by_id: dict = {}
    errors: dict = {}

    with httpx.Client(timeout=30, follow_redirects=True) as client:
        for item in images:
            image_id, url = item.get("id"), item.get("url")
            if not image_id or not url:
                continue
            try:
                resp = client.get(url)
                resp.raise_for_status()
                buf = np.frombuffer(resp.content, dtype=np.uint8)
                cv_image = cv2.imdecode(buf, cv2.IMREAD_COLOR)
                if cv_image is None:
                    errors[image_id] = "not a decodable image"
                    continue

                h, w = cv_image.shape[:2]
                results = []
                for face in detector.get(cv_image):
                    x1, y1, x2, y2 = face.bbox.astype(float)
                    box = {
                        "x": float(x1 / w),
                        "y": float(y1 / h),
                        "w": float((x2 - x1) / w),
                        "h": float((y2 - y1) / h),
                    }
                    quality = float(face.det_score) * min(1.0, box["w"] * box["h"] * 20)
                    results.append({**box, "quality": quality})
                faces_by_id[image_id] = results
            except Exception as exc:  # per-image isolation
                errors[image_id] = str(exc)[:200]

    return {"ok": True, "faces": faces_by_id, "errors": errors}
