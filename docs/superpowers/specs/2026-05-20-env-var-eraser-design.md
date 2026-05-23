# env-var-eraser — Design Spec

**Date:** 2026-05-20
**Status:** Approved

## Problem

Env vars and secrets copy-pasted into a Claude Code conversation are written
in plaintext to that session's transcript file
(`~/.claude/projects/<project>/<session-id>.jsonl`). They linger on disk
indefinitely. We want them auto-erased from the local transcript when a
session ends.

**Non-goal / known limitation:** This erases the *local* copy only. Pasted
text was already transmitted to the Anthropic API. Genuinely sensitive
secrets must still be rotated — this is local-disk hygiene, not revocation.

## Solution overview

A personal Claude Code skill, `env-var-eraser`, with three pieces:

1. **`erase-env-vars.py`** — a redaction engine.
2. **A `SessionEnd` hook** in `~/.claude/settings.json` that runs the engine
   on session exit.
3. **`SKILL.md`** — makes it invocable as `/env-var-eraser` for an on-demand
   sweep of the current transcript.

All files live in `~/.claude/skills/env-var-eraser/`.

## Components

### erase-env-vars.py

The redaction engine. Single Python 3 file, standard library only.

**Invocation modes:**
- `--hook` — reads the `SessionEnd` hook JSON from stdin, takes
  `transcript_path` as the target file.
- `--current <path>` — redacts a specific transcript (used by the manual
  skill invocation, which passes the active session's transcript path).

**Algorithm:**
1. Resolve the target `.jsonl` file. Abort silently if it is missing or
   resolves outside `~/.claude/projects/`.
2. Read line by line. Parse each line as JSON; recursively walk every string
   value and apply redaction. A line that fails to parse is left untouched.
3. Re-serialize each line. Because redaction operates on parsed JSON strings,
   escaping stays valid.
4. Write back only if something changed, via atomic temp-file + `rename`.
5. Append one entry to `erase.log`: ISO timestamp, session id, target file,
   and redaction counts by type. **Never log secret values.**
6. Always exit 0.

**Detection — what gets redacted:**
- **`KEY=value` assignments:** lines/substrings matching an uppercase env-var
  key (`[A-Z][A-Z0-9_]{2,}`), optional `export ` prefix, `=`, then a value.
  The key is kept; the value becomes `[REDACTED-ENV-VALUE]`.
- **Known token shapes** anywhere: OpenAI `sk-…` / `sk-ant-…`, AWS `AKIA…`,
  GitHub `ghp_/gho_/ghs_/github_pat_…`, Slack `xox[baprs]-…`, Google
  `AIza…`, JWTs (`eyJ….….…`), and PEM blocks
  (`-----BEGIN … KEY----- … -----END … KEY-----`). Replaced with
  `[REDACTED-SECRET]`.

**Allowlist:** these key names are never redacted (harmless, and redacting
them loses useful context): `PATH`, `HOME`, `PWD`, `SHELL`, `LANG`, `TERM`,
`USER`.

**Idempotent:** re-running on an already-redacted file is a no-op (the
placeholder text matches no detector).

### SessionEnd hook

Added to `~/.claude/settings.json`:

```json
"hooks": {
  "SessionEnd": [
    { "hooks": [ { "type": "command",
      "command": "python3 \"$HOME/.claude/skills/env-var-eraser/erase-env-vars.py\" --hook" } ] }
  ]
}
```

If a `SessionEnd` hook already exists, the new entry is appended, not
replaced.

### SKILL.md

Standard skill front matter + body. Invoking `/env-var-eraser` runs a manual
sweep of the **current** session's transcript and prints recent `erase.log`
entries. The body documents behavior and the local-only caveat.

## Data flow

- **Automatic:** session ends → Claude Code fires `SessionEnd` → runs the
  script `--hook` → script reads `transcript_path` from stdin → redacts that
  one file in place → appends to `erase.log`.
- **Manual:** `/env-var-eraser` → Claude runs the script `--current` against
  the active transcript → reports counts and recent log lines.

## Error handling

- Malformed JSON line → left untouched, processing continues.
- Missing / unreadable / locked target file → skipped, warning logged.
- The script never raises to the caller and always exits 0, so it cannot
  break session exit.

## Trade-offs accepted

- **In-place redaction, no backup.** A backup file would leave the secret on
  disk and defeat the purpose.
- **Resume sees placeholders.** `--resume` / `--continue` on a redacted
  session sees `[REDACTED-…]` instead of original values. This is intended.

## Testing

TDD the redaction function against synthetic fixture transcript strings —
never real transcripts. Cases: `KEY=value`, `export KEY=value`, `sk-` key,
`AKIA` key, JWT, PEM block, allowlisted key (not redacted), non-secret prose
(not redacted), already-redacted input (idempotent / no-op).

## Out of scope

- Erasing terminal scrollback (not reachable).
- Revoking or rotating secrets at the provider.
- Scanning transcripts of other projects or past sessions (current session
  only).
