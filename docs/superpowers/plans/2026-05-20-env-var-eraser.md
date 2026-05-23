# env-var-eraser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-redact env vars and secrets that were pasted into a Claude Code session from the local transcript when the session ends.

**Architecture:** A standalone Python 3 (stdlib-only) redaction engine lives in `~/.claude/skills/env-var-eraser/`. A `SessionEnd` hook runs it on every session exit against that session's transcript; the same engine is invocable on demand via the skill. Redaction is JSON-aware (parse each `.jsonl` line, walk string values), atomic, and idempotent.

**Tech Stack:** Python 3 standard library; `unittest` for tests; Claude Code `SessionEnd` hook.

**Note on git:** The skill files live in `~/.claude/`, outside any repo — there are no per-task git commits. The spec and this plan live in the `voiceai` repo's `docs/`; the user may commit those if desired. Each task ends with a verification step instead of a commit.

---

## Task 1: Redaction engine + tests

**Files:**
- Create: `~/.claude/skills/env-var-eraser/erase_env_vars.py`
- Create: `~/.claude/skills/env-var-eraser/test_erase_env_vars.py`

- [ ] **Step 1: Create the skill directory**

Run: `mkdir -p ~/.claude/skills/env-var-eraser`

- [ ] **Step 2: Write the failing tests**

Create `~/.claude/skills/env-var-eraser/test_erase_env_vars.py`:

```python
#!/usr/bin/env python3
"""Tests for erase_env_vars — run: python3 test_erase_env_vars.py"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import erase_env_vars as e


class TestRedactText(unittest.TestCase):
    def test_key_value_line(self):
        out, c = e.redact_text("OPENAI_API_KEY=sk-secretvalue123456789")
        self.assertEqual(out, "OPENAI_API_KEY=[REDACTED-ENV-VALUE]")
        self.assertEqual(c["env"], 1)

    def test_export_form(self):
        out, c = e.redact_text("export DATABASE_URL=postgres://u:p@host/db")
        self.assertEqual(out, "export DATABASE_URL=[REDACTED-ENV-VALUE]")
        self.assertEqual(c["env"], 1)

    def test_allowlisted_key_kept(self):
        out, c = e.redact_text("PATH=/usr/bin:/bin")
        self.assertEqual(out, "PATH=/usr/bin:/bin")
        self.assertEqual(c["env"], 0)

    def test_openai_token_inline(self):
        out, c = e.redact_text("my key is sk-abcdefghijklmnop1234 ok")
        self.assertEqual(out, "my key is [REDACTED-SECRET] ok")
        self.assertEqual(c["secret"], 1)

    def test_aws_key(self):
        out, c = e.redact_text("AKIAIOSFODNN7EXAMPLE here")
        self.assertIn("[REDACTED-SECRET]", out)
        self.assertEqual(c["secret"], 1)

    def test_jwt(self):
        jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEFghiJKLmno"
        out, c = e.redact_text("token " + jwt)
        self.assertEqual(out, "token [REDACTED-SECRET]")
        self.assertEqual(c["secret"], 1)

    def test_pem_block(self):
        pem = ("-----BEGIN PRIVATE KEY-----\nMIIEvQpretendkeymaterial\n"
               "-----END PRIVATE KEY-----")
        out, c = e.redact_text(pem)
        self.assertEqual(out, "[REDACTED-SECRET]")
        self.assertEqual(c["secret"], 1)

    def test_plain_prose_untouched(self):
        text = "This is a normal sentence with no secrets."
        out, c = e.redact_text(text)
        self.assertEqual(out, text)
        self.assertEqual(c, {"env": 0, "secret": 0})

    def test_idempotent(self):
        once, _ = e.redact_text("OPENAI_API_KEY=sk-abcdefghijklmnop1234")
        twice, c = e.redact_text(once)
        self.assertEqual(once, twice)
        self.assertEqual(c, {"env": 0, "secret": 0})


class TestRedactJsonlFile(unittest.TestCase):
    def _write(self, lines):
        fd, path = tempfile.mkstemp(suffix=".jsonl")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        return path

    def test_redacts_user_message(self):
        secret_line = json.dumps(
            {"type": "user", "message": {"role": "user",
             "content": "OPENAI_API_KEY=sk-abcdefghijklmnop1234"}})
        plain_line = json.dumps({"type": "x", "message": {"content": "hello"}})
        path = self._write([secret_line, plain_line])
        try:
            counts = e.redact_jsonl_file(path)
            self.assertEqual(counts["env"], 1)
            with open(path, encoding="utf-8") as f:
                body = f.read()
            self.assertIn("[REDACTED-ENV-VALUE]", body)
            self.assertNotIn("sk-abcdefghijklmnop1234", body)
            counts2 = e.redact_jsonl_file(path)
            self.assertEqual(counts2, {"env": 0, "secret": 0})
        finally:
            os.unlink(path)

    def test_malformed_line_preserved(self):
        path = self._write(["not json at all", json.dumps({"a": "b"})])
        try:
            counts = e.redact_jsonl_file(path)
            self.assertEqual(counts, {"env": 0, "secret": 0})
            with open(path, encoding="utf-8") as f:
                self.assertIn("not json at all", f.read())
        finally:
            os.unlink(path)

    def test_unreadable_returns_none(self):
        self.assertIsNone(e.redact_jsonl_file("/nonexistent/path/x.jsonl"))


class TestSafeTarget(unittest.TestCase):
    def test_rejects_outside_root(self):
        with tempfile.TemporaryDirectory() as root:
            outside = tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False)
            outside.close()
            try:
                self.assertIsNone(e._safe_target(outside.name, root=root))
            finally:
                os.unlink(outside.name)

    def test_accepts_inside_root(self):
        with tempfile.TemporaryDirectory() as root:
            p = os.path.join(root, "s.jsonl")
            with open(p, "w") as f:
                f.write("{}\n")
            self.assertEqual(e._safe_target(p, root=root), os.path.realpath(p))

    def test_rejects_non_jsonl(self):
        with tempfile.TemporaryDirectory() as root:
            p = os.path.join(root, "s.txt")
            with open(p, "w") as f:
                f.write("x")
            self.assertIsNone(e._safe_target(p, root=root))


if __name__ == "__main__":
    unittest.main(verbosity=2)
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd ~/.claude/skills/env-var-eraser && python3 test_erase_env_vars.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'erase_env_vars'`

- [ ] **Step 4: Write the redaction engine**

Create `~/.claude/skills/env-var-eraser/erase_env_vars.py`:

```python
#!/usr/bin/env python3
"""env-var-eraser — redact env vars and secrets from Claude Code transcripts.

Runs as a SessionEnd hook (--hook) or as a manual sweep (--current).
Never raises to the caller; always exits 0 so it cannot break session exit.
"""
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone

PROJECTS_DIR = os.path.expanduser("~/.claude/projects")
LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "erase.log")

ENV_VALUE_PLACEHOLDER = "[REDACTED-ENV-VALUE]"
SECRET_PLACEHOLDER = "[REDACTED-SECRET]"
_PLACEHOLDERS = {ENV_VALUE_PLACEHOLDER, SECRET_PLACEHOLDER}

# Env-var key names that are never secret — left untouched.
ALLOWLIST = {"PATH", "HOME", "PWD", "SHELL", "LANG", "TERM", "USER"}

# KEY=value / export KEY=value at the start of a line.
_KEY_VALUE_RE = re.compile(
    r"(?m)^(?P<prefix>[ \t]*(?:export[ \t]+)?(?P<key>[A-Z][A-Z0-9_]{2,})[ \t]*=[ \t]*)"
    r"(?P<value>\S.*)$"
)

# Known secret token shapes, matched anywhere.
_SECRET_RES = (
    re.compile(r"-----BEGIN [A-Z ]*?PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*?PRIVATE KEY-----"),
    re.compile(r"\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}"),
    re.compile(r"\bAIza[0-9A-Za-z_-]{35}"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}"),
)


def redact_text(text):
    """Redact env values and secret tokens from a string.

    Returns (new_text, {"env": n, "secret": m}).
    """
    counts = {"env": 0, "secret": 0}

    def _kv(m):
        if m.group("key") in ALLOWLIST:
            return m.group(0)
        if m.group("value") in _PLACEHOLDERS:
            return m.group(0)  # already redacted — idempotent
        counts["env"] += 1
        return m.group("prefix") + ENV_VALUE_PLACEHOLDER

    text = _KEY_VALUE_RE.sub(_kv, text)

    def _secret(m):
        counts["secret"] += 1
        return SECRET_PLACEHOLDER

    for rx in _SECRET_RES:
        text = rx.sub(_secret, text)

    return text, counts


def redact_obj(obj, counts):
    """Recursively redact every string in a parsed-JSON object."""
    if isinstance(obj, str):
        new, c = redact_text(obj)
        counts["env"] += c["env"]
        counts["secret"] += c["secret"]
        return new
    if isinstance(obj, list):
        return [redact_obj(x, counts) for x in obj]
    if isinstance(obj, dict):
        return {k: redact_obj(v, counts) for k, v in obj.items()}
    return obj


def _atomic_write(path, lines):
    d = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".envredact-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.writelines(lines)
        os.replace(tmp, path)
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def redact_jsonl_file(path):
    """Redact a .jsonl transcript in place. Returns counts, or None if unreadable.

    Only changed lines are re-serialized; untouched lines are kept byte-identical.
    """
    counts = {"env": 0, "secret": 0}
    try:
        with open(path, "r", encoding="utf-8") as f:
            lines = f.readlines()
    except (OSError, UnicodeDecodeError):
        return None

    out, changed = [], False
    for line in lines:
        stripped = line.strip()
        if not stripped:
            out.append(line)
            continue
        try:
            obj = json.loads(stripped)
        except json.JSONDecodeError:
            out.append(line)  # leave malformed lines untouched
            continue
        before = (counts["env"], counts["secret"])
        new_obj = redact_obj(obj, counts)
        if (counts["env"], counts["secret"]) != before:
            changed = True
            out.append(json.dumps(new_obj, ensure_ascii=False,
                                  separators=(",", ":")) + "\n")
        else:
            out.append(line)

    if changed:
        _atomic_write(path, out)
    return counts


def _safe_target(path, root=PROJECTS_DIR):
    """Return a vetted absolute path, or None. Refuses anything outside `root`."""
    if not path:
        return None
    rp = os.path.realpath(path)
    rroot = os.path.realpath(root)
    if rp != rroot and not rp.startswith(rroot + os.sep):
        return None
    if not rp.endswith(".jsonl") or not os.path.isfile(rp):
        return None
    return rp


def _most_recent_transcript(root=PROJECTS_DIR):
    best, best_mtime = None, -1.0
    for dirpath, _, files in os.walk(root):
        for name in files:
            if not name.endswith(".jsonl"):
                continue
            p = os.path.join(dirpath, name)
            try:
                m = os.path.getmtime(p)
            except OSError:
                continue
            if m > best_mtime:
                best, best_mtime = p, m
    return best


def _log(session_id, target, counts, note=""):
    ts = datetime.now(timezone.utc).isoformat()
    line = (f"{ts}\tsession={session_id}\tfile={target}"
            f"\tenv={counts['env']}\tsecret={counts['secret']}")
    if note:
        line += f"\t{note}"
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def main(argv):
    mode = argv[1] if len(argv) > 1 else ""
    transcript, session_id = None, "unknown"

    if mode == "--hook":
        try:
            data = json.load(sys.stdin)
            transcript = data.get("transcript_path")
            session_id = data.get("session_id", "unknown")
        except (json.JSONDecodeError, ValueError):
            return 0
    elif mode == "--current":
        transcript = argv[2] if len(argv) > 2 else _most_recent_transcript()
    else:
        sys.stderr.write(
            "usage: erase_env_vars.py --hook | --current [transcript.jsonl]\n")
        return 0

    target = _safe_target(transcript)
    if not target:
        if mode == "--current":
            print("env-var-eraser: no valid transcript found.")
        _log(session_id, transcript or "?", {"env": 0, "secret": 0},
             note="skipped:invalid-target")
        return 0

    counts = redact_jsonl_file(target)
    if counts is None:
        if mode == "--current":
            print("env-var-eraser: could not read " + target)
        _log(session_id, target, {"env": 0, "secret": 0}, note="skipped:unreadable")
        return 0

    if counts["env"] or counts["secret"]:
        _log(session_id, target, counts)

    if mode == "--current":
        if counts["env"] or counts["secret"]:
            print(f"env-var-eraser: redacted {counts['env']} env value(s) and "
                  f"{counts['secret']} secret(s) from {os.path.basename(target)}")
        else:
            print("env-var-eraser: nothing to redact in "
                  + os.path.basename(target))
    return 0


if __name__ == "__main__":
    try:
        rc = main(sys.argv)
    except Exception as exc:  # never break session exit
        try:
            with open(LOG_PATH, "a", encoding="utf-8") as f:
                f.write(f"{datetime.now(timezone.utc).isoformat()}\tERROR\t{exc!r}\n")
        except OSError:
            pass
        rc = 0
    sys.exit(rc)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ~/.claude/skills/env-var-eraser && python3 test_erase_env_vars.py`
Expected: PASS — `OK` with 15 tests run.

- [ ] **Step 6: Verify**

Confirm both files exist and tests pass. No commit (files are outside any repo).

---

## Task 2: SKILL.md

**Files:**
- Create: `~/.claude/skills/env-var-eraser/SKILL.md`

- [ ] **Step 1: Write SKILL.md**

Create `~/.claude/skills/env-var-eraser/SKILL.md`:

```markdown
---
name: env-var-eraser
description: Redact env vars and secrets from Claude Code session transcripts. Use to manually sweep the current transcript for pasted secrets, or to review what the SessionEnd auto-eraser has redacted.
---

# env-var-eraser

Removes env vars and secret tokens that were copy-pasted into a Claude Code
session from the local transcript files under `~/.claude/projects/`.

## How it works

A `SessionEnd` hook runs `erase_env_vars.py --hook` automatically every time
a session ends, redacting that session's transcript in place. Pasted secrets
become `[REDACTED-ENV-VALUE]` or `[REDACTED-SECRET]`.

## Manual sweep

When the user invokes this skill, run an immediate sweep of the current
transcript instead of waiting for session exit:

1. Run: `python3 ~/.claude/skills/env-var-eraser/erase_env_vars.py --current`
2. Report the script's output to the user.
3. Show the last few log entries:
   `tail -n 5 ~/.claude/skills/env-var-eraser/erase.log`

## What it detects

- `KEY=value` and `export KEY=value` lines (uppercase keys; value redacted,
  key kept). Harmless keys — `PATH`, `HOME`, `PWD`, `SHELL`, `LANG`, `TERM`,
  `USER` — are left alone.
- Known secret shapes anywhere: `sk-...`, `sk-ant-...`, AWS `AKIA...`, GitHub
  `ghp_/gho_/ghs_/github_pat_...`, Slack `xox...`, Google `AIza...`, JWTs,
  and PEM private-key blocks.

## Important limitations

- **Local only.** This erases the on-disk transcript copy. Pasted text was
  already sent to the Anthropic API — rotate anything genuinely sensitive.
- **Resume sees placeholders.** `--resume` / `--continue` on a redacted
  session shows `[REDACTED-...]` instead of the original values.
- Broad `KEY=value` matching may also redact non-secret uppercase constants
  in pasted code. That is intentional (safe over-redaction).
```

- [ ] **Step 2: Verify**

Run: `head -5 ~/.claude/skills/env-var-eraser/SKILL.md`
Expected: shows the YAML front matter with `name: env-var-eraser`.

---

## Task 3: Register the SessionEnd hook

**Files:**
- Modify: `~/.claude/settings.json`

- [ ] **Step 1: Back up current settings**

Run: `cp ~/.claude/settings.json ~/.claude/settings.json.pre-envvareraser`

- [ ] **Step 2: Add the SessionEnd hook**

Add a top-level `"hooks"` key to `~/.claude/settings.json` (the file currently has no `hooks` key — insert it; if a `SessionEnd` array already exists, append the entry rather than replacing):

```json
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"$HOME/.claude/skills/env-var-eraser/erase_env_vars.py\" --hook"
          }
        ]
      }
    ]
  }
```

- [ ] **Step 3: Verify the JSON is valid**

Run: `python3 -m json.tool ~/.claude/settings.json > /dev/null && echo "valid JSON"`
Expected: `valid JSON`

- [ ] **Step 4: Verify the hook is present**

Run: `python3 -c "import json; print('SessionEnd' in json.load(open('$HOME/.claude/settings.json')).get('hooks', {}))"`
Expected: `True`

---

## Task 4: End-to-end verification

**Files:** none (verification only — uses a throwaway fixture under `~/.claude/projects/`)

- [ ] **Step 1: Build a synthetic transcript fixture inside the projects dir**

The `--hook` path only redacts files under `~/.claude/projects/`, so the fixture must live there.

Run:
```bash
VDIR=~/.claude/projects/_envvareraser-verify
mkdir -p "$VDIR"
FIXTURE="$VDIR/session.jsonl"
python3 - "$FIXTURE" <<'PY'
import json, sys
with open(sys.argv[1], "w") as f:
    f.write(json.dumps({"type": "user", "message": {"role": "user",
        "content": "here are my secrets:\nOPENAI_API_KEY=sk-abcdefghijklmnop1234\nexport AWS_SECRET=AKIAIOSFODNN7EXAMPLE"}}) + "\n")
    f.write(json.dumps({"type": "assistant", "message": {"content": "ok thanks"}}) + "\n")
PY
echo "fixture: $FIXTURE"
```

- [ ] **Step 2: Simulate the SessionEnd hook**

Run:
```bash
FIXTURE=~/.claude/projects/_envvareraser-verify/session.jsonl
echo "{\"transcript_path\": \"$FIXTURE\", \"session_id\": \"verify-test\", \"hook_event_name\": \"SessionEnd\"}" \
  | python3 ~/.claude/skills/env-var-eraser/erase_env_vars.py --hook
echo "exit: $?"
```
Expected: `exit: 0`, no other output.

- [ ] **Step 3: Confirm the fixture was redacted**

Run:
```bash
FIXTURE=~/.claude/projects/_envvareraser-verify/session.jsonl
echo "redactions: $(grep -o 'REDACTED-ENV-VALUE' "$FIXTURE" | wc -l | tr -d ' ')"
grep -q 'sk-abcdefghijklmnop1234\|AKIAIOSFODNN7EXAMPLE' "$FIXTURE" \
  && echo "FAIL: secret remains" || echo "OK: 0 secrets remain"
```
Expected: `redactions: 2` and `OK: 0 secrets remain`.

- [ ] **Step 4: Confirm idempotency**

Run:
```bash
FIXTURE=~/.claude/projects/_envvareraser-verify/session.jsonl
BEFORE=$(md5 -q "$FIXTURE" 2>/dev/null || md5sum "$FIXTURE" | cut -d' ' -f1)
echo "{\"transcript_path\": \"$FIXTURE\", \"session_id\": \"verify-2\"}" \
  | python3 ~/.claude/skills/env-var-eraser/erase_env_vars.py --hook
AFTER=$(md5 -q "$FIXTURE" 2>/dev/null || md5sum "$FIXTURE" | cut -d' ' -f1)
[ "$BEFORE" = "$AFTER" ] && echo "OK: idempotent" || echo "FAIL: changed on re-run"
```
Expected: `OK: idempotent`.

- [ ] **Step 5: Confirm the engine refuses paths outside the projects dir**

Run:
```bash
OUT="/tmp/envvareraser-test-$$.jsonl"
echo '{"type":"user","message":{"content":"OPENAI_API_KEY=sk-abcdefghijklmnop1234"}}' > "$OUT"
echo "{\"transcript_path\": \"$OUT\", \"session_id\": \"verify-3\"}" \
  | python3 ~/.claude/skills/env-var-eraser/erase_env_vars.py --hook
grep -q 'sk-abcdefghijklmnop1234' "$OUT" \
  && echo "OK: out-of-scope file untouched" || echo "FAIL: touched out-of-scope file"
rm -f "$OUT"
```
Expected: `OK: out-of-scope file untouched`.

- [ ] **Step 6: Inspect the log and clean up**

Run:
```bash
tail -n 4 ~/.claude/skills/env-var-eraser/erase.log
rm -rf ~/.claude/projects/_envvareraser-verify
```
Expected: the log shows the `verify-test` run with `env=2 secret=0` and a `skipped:invalid-target` entry for `verify-3`.

- [ ] **Step 7: Final report**

Confirm: 15 tests pass, `SKILL.md` present, `settings.json` valid with the `SessionEnd` hook, and redaction + idempotency + path-safety verified end-to-end. The hook runs automatically on the next real session exit.

---

## Self-review notes

- **Spec coverage:** redaction engine (Task 1), detection patterns + allowlist (Task 1), atomic write + idempotency (Task 1 tests + Task 4 Step 4), path safety (Task 1 `_safe_target` + Task 4 Step 5), `SessionEnd` hook (Task 3), `SKILL.md` manual mode (Task 2), error handling / always-exit-0 (Task 1 `main` + `__main__` guard). All covered.
- **Verification scope:** the e2e fixture is created under `~/.claude/projects/` (a throwaway `_envvareraser-verify` dir, deleted in Step 6) so the `--hook` path-safety check passes; Step 5 separately confirms a `/tmp` path is refused.
