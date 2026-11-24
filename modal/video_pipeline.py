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
  4. `mute_video`, a SEPARATE endpoint (Scout crew clips, 2026-11-24): the rendition is
     written WITHOUT audio (video stream copied untouched, every audio,
     subtitle and data stream dropped, container metadata cleared), and the
     written file is ffprobed again: any audio stream left is an error, never
     an upload. The response says `muted: true` only after that check. A
     deployment from before this endpoint existed has no `mute_video` URL at
     all (404), so it can never receive a clip, let alone write one.

The function is credential-free: the Next.js side presigns every URL it needs.
Auth: shared secret `pipeline_key` in the JSON payload (the body already
carries presigned URLs over TLS), checked against the Modal secret
`video-pipeline` (key VIDEO_PIPELINE_KEY).

Setup:  modal secret create video-pipeline VIDEO_PIPELINE_KEY=<random>
Deploy: modal deploy modal/video_pipeline.py
"""

import json
import re
import subprocess
import tempfile
import urllib.error
import urllib.request

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


# A muted source is downloaded first (one read, no redirects); Scout caps clips
# at 50 MB, so anything much larger is not a clip we asked for.
MUTE_SOURCE_MAX_BYTES = 55 * 1024 * 1024
MUTE_SOURCE_TIMEOUT_S = 90

_SIGNED_QUERY = re.compile(r"""(https?://[^\s?'"<>]+)\?[^\s'"<>]*""")


def scrub_urls(text: str) -> str:
    """Replace every URL's query string (signatures, tokens) with ?<redacted>,
    so an error message can be logged and returned without a credential."""
    return _SIGNED_QUERY.sub(r"\1?<redacted>", text or "")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # urllib then raises HTTPError for the 3xx itself


def download_no_redirects(
    url: str,
    dest: str,
    max_bytes: int = MUTE_SOURCE_MAX_BYTES,
    timeout: float = MUTE_SOURCE_TIMEOUT_S,
    require_https: bool = True,
) -> int:
    """Fetch `url` to `dest` ONCE: no redirects followed (the server's rule),
    a deadline, and a byte cap counted while reading. Every later step (probe,
    poster, the muted copy) reads this one local file, so they cannot see
    different objects behind the same URL."""
    if require_https and not url.startswith("https://"):
        raise ValueError("source must be https")
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        resp = opener.open(url, timeout=timeout)
    except urllib.error.HTTPError as err:
        raise ValueError(f"source answered HTTP {err.code} (redirects are not followed)") from None
    total = 0
    with resp, open(dest, "wb") as out:
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise ValueError(f"source is over the {max_bytes}-byte limit")
            out.write(chunk)
    if total == 0:
        raise ValueError("source is empty")
    return total


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


def _check_key(payload: dict) -> None:
    import os

    from fastapi import HTTPException

    expected = os.environ.get("VIDEO_PIPELINE_KEY")
    if expected and payload.get("pipeline_key") != expected:
        raise HTTPException(status_code=401, detail="bad pipeline_key")


def _scrubbed(run):
    """Run `run()`; any failure is re-raised with every URL's query string
    removed and the original exception NOT chained (its message can carry a
    signed URL into the log)."""
    from fastapi import HTTPException

    try:
        return run()
    except HTTPException:
        raise
    except Exception as err:  # noqa: BLE001 - scrubbed and re-raised
        raise RuntimeError(scrub_urls(f"{type(err).__name__}: {err}")) from None


@app.function(
    image=video_image,
    timeout=600,  # a 500MB remux + upload fits comfortably
    memory=2048,
    secrets=[modal.Secret.from_name("video-pipeline")],
)
@modal.fastapi_endpoint(method="POST")
def process_video(payload: dict):
    """
    The upload path's pipeline (sound kept). Input JSON:
      {
        "pipeline_key": shared secret (must match Modal secret VIDEO_PIPELINE_KEY),
        "video_url":   presigned GET of the original,
        "poster_puts": {"sm": url, "md": url, "lg": url},  # presigned PUTs
        "display_put": url | null  # presigned PUT for the .mov→.mp4 remux
      }

    Returns metadata on success, or {"ok": false, "error": "..."} for
    unsupported codecs (a clean rejection, not a retryable failure).
    Muting is NOT done here: it has its own endpoint, `mute_video`, so a caller
    that wants silence can never be answered by a function that keeps sound.
    """
    from fastapi import HTTPException

    _check_key(payload)
    if payload.get("mute"):
        raise HTTPException(status_code=400, detail="mute is handled by the mute_video endpoint")
    return _scrubbed(
        lambda: _pipeline(
            payload["video_url"], payload["poster_puts"], payload.get("display_put"), False
        )
    )


@app.function(
    image=video_image,
    timeout=600,
    memory=2048,
    secrets=[modal.Secret.from_name("video-pipeline")],
)
@modal.fastapi_endpoint(method="POST")
def mute_video(payload: dict):
    """
    The SILENT copy (Scout crew clips, 2026-11-24). Its own endpoint and URL
    (VIDEO_MUTE_URL on the app side): a deployment without it answers 404, so
    an old function can never receive a clip or write anything. Input JSON:
      {
        "pipeline_key": shared secret,
        "video_url":   the clip (an https signed URL; read ONCE, no redirects),
        "poster_puts": {"sm": url, "md": url, "lg": url},
        "staged_put":  presigned PUT for the silent copy, under a staging key
      }
    The copy is written with every audio, subtitle, data and chapter stream
    dropped, re-probed, and uploaded only if it has no audio; the answer
    (`muted: true`, duration, codec) describes the file it WROTE. The caller
    verifies the staged bytes again before filing them.
    """
    from fastapi import HTTPException

    _check_key(payload)
    staged_put = payload.get("staged_put")
    if not staged_put:
        raise HTTPException(status_code=400, detail="staged_put is required")

    def run():
        with tempfile.TemporaryDirectory() as src_tmp:
            # One read of the source, no redirects; it never leaves this
            # container's temp dir, which is removed on every path.
            local = f"{src_tmp}/source.mp4"
            download_no_redirects(payload["video_url"], local)
            return _pipeline(local, payload["poster_puts"], staged_put, True)

    return _scrubbed(run)


def _pipeline(video_url: str, poster_puts: dict, display_put, mute: bool) -> dict:
    """Probe, posters and the rendition. `video_url` is a local file in mute mode."""
    import httpx

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
                    # The file we WROTE is the one source of truth for a muted
                    # copy: its audio count, its codec and its length.
                    written = _probe(display_path)
                    left = sum(1 for st in written.get("streams", []) if st.get("codec_type") == "audio")
                    if left != 0:
                        raise ValueError(f"mute failed: {left} audio stream(s) left")
                    out_video = next(
                        (st for st in written.get("streams", []) if st.get("codec_type") == "video"),
                        None,
                    )
                    out_codec = ((out_video or {}).get("codec_name") or "?").lower()
                    if out_codec not in ALLOWED_VIDEO_CODECS:
                        raise ValueError(f"muted copy has video codec '{out_codec}', not H.264")
                    video_codec = out_codec
                    duration = float(written.get("format", {}).get("duration") or 0) or None
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
