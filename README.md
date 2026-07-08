# Nicbytes Website + Flask Test Server

This package contains the static website for GitHub Pages **and** a local Flask backend for testing.

## Start local Flask test server

Double-click:

```text
run-flask.bat
```

Or run manually:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

Open:

```text
http://127.0.0.1:5000
```

## Local test admin

Open:

```text
http://127.0.0.1:5000/admin
```

There you can check:
- detected music files from `/music`
- saved contact messages
- uploaded attachments

## Contact form

When you test through Flask, messages are saved locally in:

```text
data/messages.jsonl
```

Attachments are saved in:

```text
data/uploads/
```

This is for local testing only. Do **not** upload the `data/` folder to GitHub.

## Music

Put MP3 files into:

```text
music/
```

Flask detects them automatically via:

```text
/api/music
```

GitHub Pages still works without Flask. Online it uses the GitHub API or `music/playlist.json`.

## Background videos

Put background videos into:

```text
background_videos/
```

Supported formats are `.mp4`, `.webm`, `.ogg`, `.ogv`, `.mov` and `.m4v`.
If the folder has videos, the site plays them in a shuffled sequence in the background.
If the folder is empty, the original `background.mp4` fallback stays active.
If you add videos and do not use the Flask server, run `make-background-playlist.ps1` once so `background_videos/playlist.json` is updated.

## Projects and Ideas

Edit:

```text
content/projects.json
content/ideas.json
```

Then refresh the page.


## Player notes

The music player reads MP3 files from the music folder and tries to read embedded ID3 title, artist and cover artwork. If a file has no embedded cover image, the player can look up cover artwork online. When a song reaches the end, the next track starts with a short fade. Browsers may block audible autoplay until the first click, so the player starts immediately whenever the browser allows it and otherwise continues after the first interaction.
