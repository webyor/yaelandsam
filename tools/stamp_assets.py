"""Adds a content fingerprint to every local stylesheet and script link in index.html.

Each link becomes e.g. ``js/rsvp.js?v=3f9a1c2e``, where the value is the first 8 hex
characters of the file's SHA-256. When a file changes, its link changes too, so
browsers download the new file instead of reusing an old saved copy (an old cached
rsvp.js once sent RSVPs in a format the new Google script rejected).

Run it from the repo root after changing any CSS or JS file, before committing:

    python tools/stamp_assets.py

It only rewrites index.html, and only if a fingerprint actually changed. Exits with
an error if a linked file is missing, so a broken link is caught before publishing.
"""

import hashlib
import logging
import re
import sys
from pathlib import Path

log = logging.getLogger("stamp_assets")

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "index.html"

# href="css/x.css" or src="js/x.js", with or without an existing ?v=... stamp.
LINK = re.compile(
    r'(?P<attr>href|src)="(?P<path>(?:css|js)/[^"?]+\.(?:css|js))(?:\?v=[0-9a-f]*)?"'
)


def fingerprint(path: Path) -> str:
    """First 8 hex characters of the file's SHA-256."""
    return hashlib.sha256(path.read_bytes()).hexdigest()[:8]


def stamp(match: re.Match) -> str:
    rel = match.group("path")
    target = ROOT / rel
    if not target.is_file():
        sys.exit(f"stamp_assets: {rel} is linked from index.html but does not exist")
    return f'{match.group("attr")}="{rel}?v={fingerprint(target)}"'


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(name)s: %(message)s")
    original = PAGE.read_text(encoding="utf-8")
    updated, count = LINK.subn(stamp, original)
    if count == 0:
        sys.exit("stamp_assets: no css/ or js/ links found in index.html")
    if updated == original:
        log.info("%d links already up to date", count)
        return
    PAGE.write_text(updated, encoding="utf-8", newline="")
    log.info("stamped %d links in index.html", count)


if __name__ == "__main__":
    main()
