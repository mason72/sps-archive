"""
Pixeltrunk — Video Processing Pipeline (Modal, CPU + ffmpeg)

For each uploaded video (called by the Inngest "video/uploaded" function):
  1. ffprobe the original (via presigned R2 GET): duration, dimensions
     (rotation-aware), audio presence, codec validation (H.264 video,
     AAC-or-silent audio — anything else is politely rejected)
  2. Extract a poster frame and write the three thumbnail variants
     (200/400/800px JPEG) to presigned R2 PUT URLs — the SAME key scheme as
     image thumbnails, so the editor grid and site publishing work unchanged
  3. For .mov originals: losslessly remux (-c copy) to a web-playable .mp4
     rendition (Firefox won't play QuickTime containers)
  4. With `mute: true` (Scout crew clips, 2026-11-24): the rendition is
     written WITHOUT audio (video stream copied untouched, every audio,
     subtitle and data stream dropped, container metadata cleared), and the
     written file is ffprobed again: any audio stream left is an error, never
     an upload. The response says `muted: true` only after that check, and the
     caller refuses a response without it, so an older deployment that does
     not know `mute` fails closed instead of passing audio through.

The function is credential-free: the Next.js side presigns every URL it needs.
Auth: shared secret `pipeline_key` in the JSON payload (the body already
carries presigned URLs over TLS), checked against the Modal secret
`video-pipeline` (key VIDEO_PIPELINE_KEY).

Setup:  modal secret create video-pipeline VIDEO_PIPELINE_KEY=<random>
Deploy: modal deploy modal/video_pipeline.py
"""

import json
import subprocess
import tempfile

import modal

# ---------------------------------------------------------------------------
# Modal App + Image
# ---------------------------------------------------------------------------
app = modal.App("sps-archive-video")

video_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg")
    .pip_install(
        "httpx==0.28.0",
        "fastapi[standard]",
    )
)

POSTER_VARIANTS = [
    ("sm", 200, 5),
    ("md", 400, 4),
    ("lg", 800, 3),
]

ALLOWED_VIDEO_CODECS = {"h264"}
ALLOWED_AUDIO_CODECS = {"aac"}


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=540)


def _probe(url: str) -> dict:
    """ffprobe the source; raises on unreadable input."""
    result = _run(
        [
            "ffprobe",
            "-v", "error",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            url,
        ]
    )
    if result.returncode != 0:
        raise ValueError(f"ffprobe failed: {result.stderr[-500:]}")
    return json.loads(result.stdout)


def display_cmd(src: str, dest: str, mute: bool) -> list:
    """The ffmpeg command for the web rendition. Pure, so it can be tested
    without Modal. Muted: map the first video stream only, copy it as is
    (lossless, no re-encode), drop audio/subtitle/data, clear metadata."""
    if mute:
        return [
            "ffmpeg", "-v", "error",
            "-i", src,
            "-map", "0:v:0",
            "-c:v", "copy",
            "-an", "-sn", "-dn",
            "-map_metadata", "-1",
            "-map_chapters", "-1",
            "-movflags", "+faststart",
            "-y", dest,
        ]
    return [
        "ffmpeg", "-v", "error",
        "-i", src,
        "-c", "copy",
        "-movflags", "+faststart",
        "-y", dest,
    ]


def audio_stream_count(path: str) -> int:
    """How many audio streams ffprobe finds in a local file."""
    probe = _probe(path)
    return sum(1 for s in probe.get("streams", []) if s.get("codec_type") == "audio")


def _rotation(stream: dict) -> int:
    """Degrees of display rotation, from side data or legacy tags."""
    for sd in stream.get("side_data_list", []) or []:
        if "rotation" in sd:
            return abs(int(sd["rotation"])) % 360
    tag_rot = (stream.get("tags") or {}).get("rotate")
    return abs(int(tag_rot)) % 360 if tag_rot else 0


@app.function(
    image=video_image,
    timeout=600,  # a 500MB remux + upload fits comfortably
    memory=2048,
    secrets=[modal.Secret.from_name("video-pipeline")],
)
@modal.fastapi_endpoint(method="POST")
def process_video(payload: dict):
    """
    Input JSON:
      {
        "pipeline_key": shared secret (must match Modal secret VIDEO_PIPELINE_KEY),
        "video_url":   presigned GET of the original,
        "poster_puts": {"sm": url, "md": url, "lg": url},  # presigned PUTs
        "display_put": url | null  # presigned PUT for the .mov→.mp4 remux
        "mute": bool (optional)    # write the rendition with NO audio; needs display_put
      }

    Returns metadata on success, or {"ok": false, "error": "..."} for
    unsupported codecs (a clean rejection, not a retryable failure).
    """
    import os

    import httpx
    from fastapi import HTTPException

    expected = os.environ.get("VIDEO_PIPELINE_KEY")
    if expected and payload.get("pipeline_key") != expected:
        raise HTTPException(status_code=401, detail="bad pipeline_key")

    video_url = payload["video_url"]
    poster_puts = payload["poster_puts"]
    display_put = payload.get("display_put")
    mute = bool(payload.get("mute"))
    if mute and not display_put:
        # Muting is done on the rendition; without one, nothing would be muted.
        raise HTTPException(status_code=400, detail="mute requires display_put")

    # ── 1. Probe + validate ──────────────────────────────────────────────
    probe = _probe(video_url)
    video_stream = next(
        (s for s in probe.get("streams", []) if s.get("codec_type") == "video"),
        None,
    )
    audio_stream = next(
        (s for s in probe.get("streams", []) if s.get("codec_type") == "audio"),
        None,
    )
    if video_stream is None:
        return {"ok": False, "error": "No video track found in this file"}

    video_codec = (video_stream.get("codec_name") or "?").lower()
    if video_codec not in ALLOWED_VIDEO_CODECS:
        return {
            "ok": False,
            "error": (
                f"Unsupported video codec '{video_codec}' — please export as "
                "H.264 (MP4 or QuickTime)"
            ),
        }
    audio_codec = (
        (audio_stream.get("codec_name") or "?").lower() if audio_stream else None
    )
    # A muted copy drops the audio, so its codec does not matter (Opus, AMR).
    if audio_codec is not None and audio_codec not in ALLOWED_AUDIO_CODECS and not mute:
        return {
            "ok": False,
            "error": (
                f"Unsupported audio codec '{audio_codec}' — please export "
                "audio as AAC"
            ),
        }

    duration = float(probe.get("format", {}).get("duration") or 0) or None
    width = video_stream.get("width")
    height = video_stream.get("height")
    if _rotation(video_stream) in (90, 270):
        width, height = height, width

    # ── 2. Poster frame → three thumbnail variants ───────────────────────
    with tempfile.TemporaryDirectory() as tmp:
        poster_path = f"{tmp}/poster.jpg"
        # A beat into the clip beats frame zero (often black/fade-in); clamp
        # for very short clips.
        seek = min(1.0, (duration or 1.0) * 0.25)
        extract = _run(
            [
                "ffmpeg", "-v", "error",
                "-ss", f"{seek:.3f}",
                "-i", video_url,
                "-frames:v", "1",
                "-q:v", "2",
                "-y", poster_path,
            ]
        )
        if extract.returncode != 0:
            raise ValueError(f"poster extraction failed: {extract.stderr[-500:]}")

        with httpx.Client(timeout=120) as client:
            for name, max_width, quality in POSTER_VARIANTS:
                variant_path = f"{tmp}/poster-{name}.jpg"
                scale = _run(
                    [
                        "ffmpeg", "-v", "error",
                        "-i", poster_path,
                        "-vf", f"scale='min({max_width},iw)':-2",
                        "-q:v", str(quality),
                        "-y", variant_path,
                    ]
                )
                if scale.returncode != 0:
                    raise ValueError(
                        f"poster scale ({name}) failed: {scale.stderr[-500:]}"
                    )
                with open(variant_path, "rb") as f:
                    resp = client.put(
                        poster_puts[name],
                        content=f.read(),
                        headers={"Content-Type": "image/jpeg"},
                    )
                resp.raise_for_status()

            # ── 3. Optional lossless remux (.mov originals, or a muted copy) ─
            muted = False
            if display_put:
                display_path = f"{tmp}/display.mp4"
                remux = _run(display_cmd(video_url, display_path, mute))
                if remux.returncode != 0:
                    raise ValueError(f"remux failed: {remux.stderr[-500:]}")
                if mute:
                    left = audio_stream_count(display_path)
                    if left != 0:
                        raise ValueError(f"mute failed: {left} audio stream(s) left")
                    muted = True
                with open(display_path, "rb") as f:
                    resp = client.put(
                        display_put,
                        content=f.read(),
                        headers={"Content-Type": "video/mp4"},
                    )
                resp.raise_for_status()

    return {
        "ok": True,
        "duration_seconds": duration,
        "width": width,
        "height": height,
        "has_audio": audio_stream is not None,
        "muted": muted,
        "video_codec": video_codec,
        "audio_codec": audio_codec,
    }
