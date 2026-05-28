#!/usr/bin/env python3
"""
Inject validated DrDia transcripts into src/videos.json for the Worker bundle.

Source transcripts live outside the static site repo:
  ../../transcripts/chatbot_selection/*.txt
"""

from __future__ import annotations

import json
import re
from pathlib import Path

CHAT_WORKER = Path(__file__).resolve().parents[1]
PROJECT_ROOT = CHAT_WORKER.parents[1]
SELECTION_DIR = PROJECT_ROOT / "transcripts" / "chatbot_selection"
VIDEOS_JSON = CHAT_WORKER / "src" / "videos.json"

MAX_FULL_CHARS = 60_000
MAX_EXCERPT_CHARS = 2_400


def clean_text(text: str) -> str:
    text = text.replace("\ufeff", " ")
    text = re.sub(r"\[[^\]]{1,40}\]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def main() -> None:
    videos = json.loads(VIDEOS_JSON.read_text(encoding="utf-8"))
    by_source = {v.get("source_id") or v.get("id", "").replace("yt-", ""): v for v in videos}

    updated = 0
    missing = []
    total_chars = 0
    for path in sorted(SELECTION_DIR.glob("*.txt")):
        video_id = path.stem
        entry = by_source.get(video_id)
        if not entry:
            missing.append(video_id)
            continue

        text = clean_text(path.read_text(encoding="utf-8", errors="ignore"))
        if not text:
            continue

        entry["transcript_path"] = str(path.relative_to(PROJECT_ROOT))
        entry["transcript_source"] = "chatbot_selection"
        entry["transcript_excerpt"] = text[:MAX_EXCERPT_CHARS]
        entry["transcript_full"] = text[:MAX_FULL_CHARS]
        total_chars += len(entry["transcript_full"])
        updated += 1

    VIDEOS_JSON.write_text(json.dumps(videos, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"updated={updated} missing={len(missing)} full_chars={total_chars}")
    if missing:
        print("missing:", ", ".join(missing[:20]))


if __name__ == "__main__":
    main()
