#!/usr/bin/env python3
"""Post Claude's pull request review (.github/workflows/claude-review.yml).

The reviewer has no shell or GitHub access (it reads untrusted pull request text, so it must not be
able to approve, resolve threads or run anything). It ends with one JSON object,
{"summary": str, "findings": [{"path", "line", "body"}]}, and this trusted step posts it as a single
review with event COMMENT and commit_id = the reviewed head sha, whose body starts
"Claude review of <sha>:" (CLAUDE.md -> "Claude's review is handled before a pull request merges").

A finding GitHub won't anchor (a line outside the diff makes the whole review fail with 422) is moved
into the review body instead of being dropped. Output that can't be read fails the run, so no summary
posts and the coordinator re-runs it rather than taking silence for "no findings".

Any secret value given as REDACT_* (and GH_TOKEN) is blanked out of everything posted, in case
untrusted pull request text talked the reviewer into quoting one.

Every summary ends with what kind of review it was, what paid for it, and a hidden record
(plan-review.py reads the newest one to review only what changed since). Its findings list carries the
earlier records' findings forward, so a settled finding isn't raised again. MODE=unchanged posts with no
model call: nothing in the pull request changed since the recorded review.

Env: EXECUTION_FILE (claude-code-action's execution_file output; unset when MODE=unchanged), HEAD_SHA,
PR, GITHUB_REPOSITORY, GH_TOKEN, MODE, WHY, PAID_BY, RECORD_FILE, PREVIOUS_FILE, REDACT_*. `--dry-run` prints the review payload instead of posting it.
"""

import base64
import json
import os
import re
import subprocess
import sys


def final_text(execution_file: str) -> str:
    """The reviewer's last result message from claude-code-action's execution log."""
    with open(execution_file, encoding="utf-8") as f:
        messages = json.load(f)
    for message in reversed(messages):
        if isinstance(message, dict) and message.get("type") == "result":
            return str(message.get("result") or "")
    raise ValueError("no result message in the execution file")


def parse_review(text: str) -> dict:
    """The last JSON object in the text (the reviewer may wrap it in a code fence)."""
    fenced = re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    candidates = fenced or [text[text.find("{"): text.rfind("}") + 1]]
    review = json.loads(candidates[-1])
    if not isinstance(review.get("summary"), str) or not isinstance(review.get("findings"), list):
        raise ValueError("review JSON lacks summary or findings")
    for finding in review["findings"]:
        if not (isinstance(finding.get("path"), str) and isinstance(finding.get("line"), int) and isinstance(finding.get("body"), str)):
            raise ValueError(f"malformed finding: {finding!r}")
    return review


def inert(text: str) -> str:
    """Model-written text with HTML comment markers broken, so it can't open or close a hidden block
    (a fake review record, or one that cuts the real record short)."""
    return text.replace("<!--", "<\u200b!--").replace("-->", "--\u200b>")


MAX_CARRIED_FINDINGS = 60


def footer(review: dict) -> str:
    """What the review was and what paid for it, then the record the next review reads."""
    record = {}
    try:
        with open(os.environ["RECORD_FILE"], encoding="utf-8") as f:
            record = json.load(f)
        with open(os.environ["PREVIOUS_FILE"], encoding="utf-8") as f:
            previous = json.load(f)
    except (OSError, KeyError, ValueError):
        previous = {}
    carried = previous.get("findings", []) if isinstance(previous.get("findings"), list) else []
    new = [{"path": f["path"], "line": f["line"], "at": os.environ.get("HEAD_SHA", "")[:7], "gist": f["body"][:160]} for f in review["findings"]]
    record["findings"] = (carried + new)[-MAX_CARRIED_FINDINGS:]
    note = f"_{os.environ.get('WHY', '')}; paid by {os.environ.get('PAID_BY', 'n/a')}._"
    # One line, with < and > escaped so no path or gist can end the comment early.
    encoded = json.dumps(record, separators=(",", ":")).replace("<", "\\u003c").replace(">", "\\u003e")
    return f"\n\n{note}\n\n<!-- claude-review-record {encoded} -->"


def payload(review: dict, head: str, inline: bool) -> dict:
    """One COMMENT review; with inline False every finding goes in the body instead."""
    body = f"Claude review of {head}: {inert(review['summary'])}"
    comments = []
    for finding in review["findings"]:
        if inline:
            comments.append({"path": finding["path"], "line": finding["line"], "side": "RIGHT", "body": inert(finding["body"])})
        else:
            body += f"\n\n**{inert(finding['path'])}:{finding['line']}**\n\n{inert(finding['body'])}"
    body += footer(review)
    result = {"event": "COMMENT", "commit_id": head, "body": body}
    if comments:
        result["comments"] = comments
    return result


def redact(text: str) -> str:
    """Every secret value this run holds, blanked out."""
    secrets = [value for key, value in os.environ.items() if (key.startswith("REDACT_") or key == "GH_TOKEN") and len(value) >= 8]
    if os.environ.get("GH_TOKEN"):
        # The form actions/checkout writes into git's config, in case a credential is ever on disk.
        secrets.append(base64.b64encode(f"x-access-token:{os.environ['GH_TOKEN']}".encode()).decode())
    for secret in secrets:
        text = text.replace(secret, "[redacted]")
    return text


def post(data: dict) -> str:
    """'ok', 'unprocessable' (GitHub refused the review's content: HTTP 422) or 'failed'."""
    url = f"repos/{os.environ['GITHUB_REPOSITORY']}/pulls/{os.environ['PR']}/reviews"
    done = subprocess.run(["gh", "api", "-X", "POST", url, "--input", "-"], input=redact(json.dumps(data)), text=True, capture_output=True)
    if done.returncode == 0:
        return "ok"
    print(done.stdout, done.stderr, file=sys.stderr)
    return "unprocessable" if "HTTP 422" in done.stderr else "failed"


def main() -> int:
    head = os.environ["HEAD_SHA"]
    if os.environ.get("MODE") == "unchanged":
        review = {"summary": "no changes to review: no file of this pull request changed since the last recorded review.", "findings": []}
        if "--dry-run" in sys.argv:
            print(redact(json.dumps(payload(review, head, inline=False), indent=2)))
            return 0
        return 0 if post(payload(review, head, inline=False)) == "ok" else 1
    try:
        review = parse_review(final_text(os.environ["EXECUTION_FILE"]))
    except (OSError, ValueError, KeyError) as error:
        print(f"claude-review: could not read the reviewer's output: {error}", file=sys.stderr)
        return 1
    if "--dry-run" in sys.argv:
        print(redact(json.dumps(payload(review, head, inline=True), indent=2)))
        return 0
    first = post(payload(review, head, inline=True))
    if first == "ok":
        return 0
    # A 422 is usually a finding on a line outside the diff: post again with every finding in the body.
    # Any other failure isn't retried here, so a review GitHub did accept is never posted twice.
    if first == "unprocessable" and review["findings"]:
        return 0 if post(payload(review, head, inline=False)) == "ok" else 1
    return 1


if __name__ == "__main__":
    sys.exit(main())
