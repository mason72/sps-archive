"""
Proof that the video pipeline's `mute` rendition carries no audio.

Runs locally with plain python3 and Homebrew ffmpeg; `modal` is stubbed, so no
Modal account or deploy is needed. It builds a real H.264 + AAC clip (a tone
over a test pattern), runs the SAME ffmpeg command the pipeline runs
(`display_cmd`), and asserts on ffprobe of the result:

  - muted rendition: 0 audio streams, 1 video stream, video bytes unchanged
    (the stream is copied, never re-encoded), duration kept
  - control: the un-muted command on the same clip KEEPS its audio stream,
    so a broken mute would show up here as a failure, not a pass

    python3 -I modal/tests/test_video_mute.py
"""
import importlib.util
import json
import subprocess
import sys
import tempfile
import types
from pathlib import Path
from unittest import mock


def load_pipeline():
    fake = types.ModuleType("modal")
    fake.App = mock.MagicMock()
    fake.Image = mock.MagicMock()
    fake.Secret = mock.MagicMock()
    fake.fastapi_endpoint = lambda **kw: (lambda f: f)
    sys.modules["modal"] = fake
    path = Path(__file__).resolve().parent.parent / "video_pipeline.py"
    spec = importlib.util.spec_from_file_location("video_pipeline", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", path],
        capture_output=True, text=True, check=True,
    ).stdout
    return json.loads(out)


def kinds(p):
    return sorted(s["codec_type"] for s in p["streams"])


def video_packets_md5(path):
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-map", "0:v:0", "-c", "copy", "-f", "md5", "-"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return out


def main():
    vp = load_pipeline()
    with tempfile.TemporaryDirectory() as tmp:
        src = f"{tmp}/src.mp4"
        subprocess.run(
            ["ffmpeg", "-v", "error",
             "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=3",
             "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
             "-metadata", "title=client name here", "-y", src],
            check=True,
        )
        assert kinds(probe(src)) == ["audio", "video"], kinds(probe(src))

        muted = f"{tmp}/muted.mp4"
        r = subprocess.run(vp.display_cmd(src, muted, True), capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        p = probe(muted)
        assert kinds(p) == ["video"], f"muted rendition has {kinds(p)}"
        assert vp.audio_stream_count(muted) == 0
        assert "title" not in (p["format"].get("tags") or {}), "metadata survived"
        assert video_packets_md5(muted) == video_packets_md5(src), "video was re-encoded"
        assert abs(float(p["format"]["duration"]) - 3.0) < 0.2

        control = f"{tmp}/control.mp4"
        r = subprocess.run(vp.display_cmd(src, control, False), capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        assert kinds(probe(control)) == ["audio", "video"], "control lost its audio"
        assert vp.audio_stream_count(control) == 1

        # Keep the files for the TypeScript box-parser check, when asked.
        if len(sys.argv) > 1:
            out = Path(sys.argv[1])
            out.mkdir(parents=True, exist_ok=True)
            for name in ("src.mp4", "muted.mp4"):
                (out / name).write_bytes(Path(tmp, name).read_bytes())
    print("ok: muted rendition has no audio stream; control keeps it")


if __name__ == "__main__":
    main()
