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


def check_download(vp, clip_path, tmp):
    """One read, no redirects, a byte cap: served by a local HTTP server."""
    import http.server
    import threading

    body = Path(clip_path).read_bytes()

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/redirect":
                self.send_response(302)
                self.send_header("Location", "/clip.mp4")
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    try:
        dest = f"{tmp}/dl.mp4"
        n = vp.download_no_redirects(f"{base}/clip.mp4", dest, require_https=False)
        assert n == len(body) and Path(dest).read_bytes() == body
        for url, kw, why in [
            (f"{base}/redirect", {}, "302"),
            (f"{base}/clip.mp4", {"max_bytes": 1000}, "limit"),
        ]:
            try:
                vp.download_no_redirects(url, f"{tmp}/x.mp4", require_https=False, **kw)
            except ValueError as err:
                assert why in str(err), err
            else:
                raise AssertionError(f"{url} {kw} was accepted")
        try:
            vp.download_no_redirects(f"{base}/clip.mp4", f"{tmp}/y.mp4")
        except ValueError as err:
            assert "https" in str(err)
        else:
            raise AssertionError("plain http accepted")
    finally:
        srv.shutdown()


def check_pipeline_reports_the_written_file(vp, src):
    """Run the real _pipeline (ffmpeg and all) in mute mode with the network
    faked, and a FIRST probe that lies about the source (999 s). The answer
    must describe the file the pipeline WROTE: about 3 s, H.264, no audio."""
    puts = {}

    class FakeResp:
        def raise_for_status(self):
            pass

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def put(self, url, content=None, headers=None):
            puts[url] = content
            return FakeResp()

    fake_httpx = types.ModuleType("httpx")
    fake_httpx.Client = FakeClient
    sys.modules["httpx"] = fake_httpx

    real_probe = vp._probe

    def lying_probe(path):
        p = real_probe(path)
        if path == src:
            p["format"]["duration"] = "999.0"
        return p

    vp._probe = lying_probe
    try:
        out = vp._pipeline(src, {"sm": "put-sm", "md": "put-md", "lg": "put-lg"}, "put-display", True)
    finally:
        vp._probe = real_probe
    assert out["ok"] and out["muted"] is True, out
    assert abs(out["duration_seconds"] - 3.0) < 0.2, f"length came from the first read: {out}"
    assert out["video_codec"] == "h264", out
    with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
        f.write(puts["put-display"])
        f.flush()
        assert vp.audio_stream_count(f.name) == 0, "uploaded copy has audio"


def check_scrub(vp):
    fake = "FAKE-TOKEN-0123456789abcdef"
    msg = (
        "ffprobe failed: https://ezubznenjcogwocccznj.supabase.co/storage/v1/object/sign/p/c.mp4"
        f"?token={fake}&x=1: Invalid data; also 'https://r2.example/k?X-Amz-Signature={fake}'"
    )
    out = vp.scrub_urls(msg)
    assert fake not in out, out
    assert "c.mp4?<redacted>" in out and "r2.example/k?<redacted>" in out, out
    assert vp.scrub_urls("no url here") == "no url here"


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

        check_download(vp, src, tmp)
        check_pipeline_reports_the_written_file(vp, src)
        check_scrub(vp)

        # Keep the files for the TypeScript box-parser check, when asked.
        if len(sys.argv) > 1:
            out = Path(sys.argv[1])
            out.mkdir(parents=True, exist_ok=True)
            for name in ("src.mp4", "muted.mp4"):
                (out / name).write_bytes(Path(tmp, name).read_bytes())
    print("ok: muted rendition has no audio stream; control keeps it")


if __name__ == "__main__":
    main()
