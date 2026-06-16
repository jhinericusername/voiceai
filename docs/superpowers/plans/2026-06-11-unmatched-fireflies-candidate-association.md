# Unmatched Fireflies Candidate Association Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a report-only script that proposes Ashby candidate/application associations for unmatched Fireflies recordings.

**Architecture:** Add a focused TypeScript module under `backend/src/weave/fireflies` with pure parsing/scoring functions and a CLI wrapper. The CLI reads the manual-review CSV, loads a candidate pool from JSON/JSONL/CSV or prints SQL for exporting that pool, then writes CSV/JSON suggestions. The matching engine is deterministic by default and has an optional provider-neutral LLM command hook for borderline decisions.

**Tech Stack:** TypeScript, Vitest, Node.js, Postgres SQL export, optional external LLM command.

---

### Task 1: Add Pure Association Tests

**Files:**
- Create: `backend/test/fireflies-candidate-association.test.ts`

- [ ] Test external attendee extraction excludes WorkWeave and the two explicitly excluded external addresses.
- [ ] Test candidate-pool SQL excludes candidates/applications already matched in `weave_fireflies_recordings`.
- [ ] Test obvious email/name inference, for example `patrick.s.bacon@relational.ai` ranking `Patrick S. Bacon`.

### Task 2: Implement Association Module

**Files:**
- Create: `backend/src/weave/fireflies/associateCandidates.ts`

- [ ] Implement CSV parsing/writing helpers.
- [ ] Implement external-email extraction from the review CSV.
- [ ] Implement candidate-pool SQL generation with cutoff and already-matched exclusions.
- [ ] Implement deterministic scoring and confidence labels.
- [ ] Implement CLI args for review CSV, candidate pool, output CSV/JSON, cutoff date, and optional LLM command.

### Task 3: Verify

**Files:**
- Modify only if tests reveal a narrowly scoped issue.

- [ ] Run focused Vitest file.
- [ ] Run backend build.
- [ ] Run backend test suite.
