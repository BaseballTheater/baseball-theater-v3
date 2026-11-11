#!/usr/bin/env python3
"""Write a pull request's files at one commit into a folder, as inert text for Claude's review.

.github/workflows/claude-review.yml runs with this repository's secrets while its reviewer reads
untrusted pull request content, so the copy it reads must not be able to act:
- Raw blobs from `git ls-tree` / `git cat-file`, never `git archive` or a checkout: those obey the pull
  request's own .gitattributes (export-ignore hides a file from the reviewer, export-subst rewrites it).
- A symlink becomes a text file naming its target, so reading it can't reach /proc/self/environ or a
  file outside the folder. Submodules are skipped.
- Anything Claude Code could load as configuration is renamed: a `.claude` folder becomes
  `dot-claude`, and `CLAUDE.md` / `CLAUDE.local.md` / `.mcp.json` get a `.txt` suffix (the prompt says
  so). A renamed path that collides with a real one in the pull request (a real `CLAUDE.md.txt` next to
  `CLAUDE.md`) stops the extraction with an error, so the reviewer never reads a decoy and the run fails
  for the coordinator to look at.

Usage: extract-pr.py <commit> <out-dir>
"""

import os
import subprocess
import sys

RENAMED_DIRS = {".claude": "dot-claude"}
RENAMED_FILES = {"CLAUDE.md": "CLAUDE.md.txt", "CLAUDE.local.md": "CLAUDE.local.md.txt", ".mcp.json": ".mcp.json.txt"}


def safe_path(path: str) -> str:
    """The path inside the copy, with configuration names made inert."""
    parts = path.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise ValueError(f"unexpected path in tree: {path!r}")
    parts = [RENAMED_DIRS.get(part, part) for part in parts[:-1]] + [RENAMED_FILES.get(parts[-1], parts[-1])]
    return "/".join(parts)


def main() -> int:
    commit, out = sys.argv[1], sys.argv[2]
    listing = subprocess.run(["git", "ls-tree", "-r", "-z", commit], check=True, capture_output=True).stdout
    entries = []
    for record in listing.split(b"\0"):
        if not record:
            continue
        meta, path = record.split(b"\t", 1)
        mode, kind, obj = meta.decode().split(" ")
        if kind == "blob":
            entries.append((mode, obj, path.decode("utf-8", "surrogateescape")))
    # One `git cat-file --batch` for every blob, not a process per file.
    batch = subprocess.Popen(["git", "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    assert batch.stdin and batch.stdout
    written = {}
    for _, _, path in entries:
        renamed = safe_path(path)
        if renamed in written:
            raise ValueError(f"{path!r} and {written[renamed]!r} would both be written as {renamed!r}")
        written[renamed] = path
    for renamed in written:
        parent = renamed.rsplit("/", 1)[0] if "/" in renamed else ""
        while parent:
            if parent in written:
                raise ValueError(f"{written[parent]!r} is a file where {written[renamed]!r} needs a folder")
            parent = parent.rsplit("/", 1)[0] if "/" in parent else ""
    for mode, obj, path in entries:
        batch.stdin.write(obj.encode() + b"\n")
        batch.stdin.flush()
        header = batch.stdout.readline().split()
        if len(header) != 3:
            raise ValueError(f"git cat-file could not read {path!r}: {b' '.join(header)!r}")
        content = batch.stdout.read(int(header[2]))
        batch.stdout.read(1)
        target = os.path.join(out, safe_path(path))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as f:
            if mode == "120000":
                f.write(b"(symlink in the pull request, not followed) -> " + content + b"\n")
            else:
                f.write(content)
    batch.stdin.close()
    batch.wait()
    return 0


if __name__ == "__main__":
    sys.exit(main())
