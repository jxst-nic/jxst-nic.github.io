from __future__ import annotations

import json
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request, send_from_directory, abort
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent
MUSIC_DIR = BASE_DIR / "music"
BACKGROUND_VIDEO_DIR = BASE_DIR / "background_videos"
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
MESSAGES_FILE = DATA_DIR / "messages.jsonl"
VIDEO_EXTENSIONS = {".mp4", ".webm", ".ogg", ".ogv", ".mov", ".m4v"}

ALLOWED_PAGE_FILES = {
    "index.html",
    "projects.html",
    "ideas.html",
    "about.html",
    "contact.html",
}

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024 * 1024  # 64 MB per request, only for local testing


def ensure_dirs() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    UPLOAD_DIR.mkdir(exist_ok=True)
    MUSIC_DIR.mkdir(exist_ok=True)
    BACKGROUND_VIDEO_DIR.mkdir(exist_ok=True)


def safe_rel(path: Path) -> str:
    return path.relative_to(BASE_DIR).as_posix()


@app.after_request
def add_no_cache_headers(response):
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/")
def home():
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/<path:filename>")
def static_files(filename: str):
    requested = BASE_DIR / filename

    if filename in ALLOWED_PAGE_FILES:
        return send_from_directory(BASE_DIR, filename)

    allowed_roots = [
        BASE_DIR / "content",
        BASE_DIR / "music",
        BASE_DIR / "background_videos",
        BASE_DIR / "data",
        BASE_DIR,
    ]

    if requested.is_file():
        # Only serve normal website/static files and saved local uploads.
        if requested.parent == BASE_DIR or any(root in requested.parents or requested == root for root in allowed_roots):
            return send_from_directory(requested.parent, requested.name)

    abort(404)


@app.get("/api/music")
def api_music():
    ensure_dirs()
    tracks = []
    for file in sorted(MUSIC_DIR.rglob("*.mp3"), key=lambda p: p.name.lower()):
        tracks.append({"src": safe_rel(file), "name": file.name})
    return jsonify({"tracks": tracks, "count": len(tracks)})


@app.get("/api/background-videos")
def api_background_videos():
    ensure_dirs()
    videos = []
    for file in sorted(BACKGROUND_VIDEO_DIR.rglob("*"), key=lambda p: p.name.lower()):
        if file.is_file() and file.suffix.lower() in VIDEO_EXTENSIONS:
            videos.append({"src": safe_rel(file), "name": file.name})
    return jsonify({"videos": videos, "count": len(videos)})


@app.post("/api/contact")
def api_contact():
    ensure_dirs()

    name = (request.form.get("name") or "").strip()
    message = (request.form.get("message") or "").strip()

    if not name or not message:
        return jsonify({"ok": False, "error": "name and message are required"}), 400

    if len(name) > 80:
        return jsonify({"ok": False, "error": "name is too long"}), 400

    if len(message) > 5000:
        return jsonify({"ok": False, "error": "message is too long"}), 400

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    folder_name = f"{stamp}-{int(time.time() * 1000)}"
    message_upload_dir = UPLOAD_DIR / folder_name
    message_upload_dir.mkdir(parents=True, exist_ok=True)

    saved_files: list[dict[str, Any]] = []
    for file in request.files.getlist("files"):
        if not file or not file.filename:
            continue

        original_name = file.filename
        safe_name = secure_filename(original_name) or f"upload-{len(saved_files) + 1}"
        destination = message_upload_dir / safe_name

        counter = 1
        while destination.exists():
            destination = message_upload_dir / f"{destination.stem}-{counter}{destination.suffix}"
            counter += 1

        file.save(destination)
        saved_files.append(
            {
                "name": original_name,
                "saved_as": safe_rel(destination),
                "size": destination.stat().st_size,
                "url": "/" + safe_rel(destination),
            }
        )

    entry = {
        "id": folder_name,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "name": name,
        "message": message,
        "files": saved_files,
    }

    with MESSAGES_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    return jsonify({"ok": True, "message": "saved locally", "entry": entry})


@app.get("/api/messages")
def api_messages():
    ensure_dirs()
    messages = []
    if MESSAGES_FILE.exists():
        for line in MESSAGES_FILE.read_text(encoding="utf-8").splitlines():
            if line.strip():
                try:
                    messages.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return jsonify({"messages": list(reversed(messages)), "count": len(messages)})


@app.get("/admin")
def admin():
    ensure_dirs()
    messages = api_messages().json["messages"]
    music = api_music().json["tracks"]

    def esc(value: Any) -> str:
        import html
        return html.escape(str(value))

    message_cards = []
    for msg in messages:
        file_links = ""
        for file in msg.get("files", []):
            file_links += f'<a href="{esc(file.get("url", "#"))}" target="_blank">{esc(file.get("name", "file"))}</a>'
        if not file_links:
            file_links = "<span>No files</span>"

        message_cards.append(
            f"""
            <article class="card">
              <div class="meta">{esc(msg.get("created_at", ""))}</div>
              <h2>{esc(msg.get("name", ""))}</h2>
              <p>{esc(msg.get("message", ""))}</p>
              <div class="files">{file_links}</div>
            </article>
            """
        )

    music_list = "".join(f"<li>{esc(track['src'])}</li>" for track in music) or "<li>No MP3s found in /music</li>"

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Nicbytes Local Test Admin</title>
  <style>
    body {{
      margin: 0;
      font-family: Inter, system-ui, -apple-system, Segoe UI, sans-serif;
      background: radial-gradient(circle at top left, #14324a, transparent 32%), #05070d;
      color: white;
      padding: 28px;
    }}
    a {{ color: #7ceeff; }}
    .top {{
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: center;
      margin-bottom: 24px;
    }}
    .pill {{
      border: 1px solid rgba(255,255,255,.2);
      background: rgba(255,255,255,.08);
      padding: 10px 14px;
      border-radius: 999px;
      text-decoration: none;
    }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
    }}
    .panel, .card {{
      border: 1px solid rgba(255,255,255,.16);
      background: rgba(255,255,255,.07);
      backdrop-filter: blur(20px);
      border-radius: 24px;
      padding: 20px;
    }}
    .card p {{
      white-space: pre-wrap;
      color: rgba(255,255,255,.78);
      line-height: 1.6;
    }}
    .meta {{
      color: rgba(255,255,255,.52);
      font-size: .82rem;
      margin-bottom: 8px;
    }}
    .files {{
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }}
    .files a, .files span {{
      border-radius: 999px;
      background: rgba(124,238,255,.12);
      padding: 8px 10px;
      text-decoration: none;
      font-size: .86rem;
    }}
    li {{ margin: 8px 0; color: rgba(255,255,255,.75); }}
  </style>
</head>
<body>
  <div class="top">
    <div>
      <h1>Local Test Admin</h1>
      <p>Only for Flask testing on your PC.</p>
    </div>
    <a class="pill" href="/">Open website</a>
  </div>

  <div class="grid">
    <section class="panel">
      <h2>Music API</h2>
      <p>{len(music)} MP3 files detected.</p>
      <ul>{music_list}</ul>
    </section>

    <section class="panel">
      <h2>Contact API</h2>
      <p>{len(messages)} saved test messages.</p>
      <p>Send a message from <a href="/contact.html">Contact</a>, then refresh this page.</p>
    </section>
  </div>

  <h2 style="margin-top:28px;">Messages</h2>
  <div class="grid">
    {''.join(message_cards) if message_cards else '<article class="card"><h2>No messages yet</h2><p>Use the contact page to test the form.</p></article>'}
  </div>
</body>
</html>"""


if __name__ == "__main__":
    ensure_dirs()
    app.run(host="127.0.0.1", port=5000, debug=True)
