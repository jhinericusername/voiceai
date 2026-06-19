# Blind Prompt Evaluation

This file tracks prompt-only grading calibration runs against already-scored
Weave interviews. It intentionally records aggregate metrics and commands, not
raw transcripts.

## 2026-06-17 Smoke Run

Command:

```bash
corepack pnpm@9.12.0 grading:evaluate:connected -- \
  --organization-id org_01KV4FF7KX24B76H7Q57QVB5CT \
  --limit 10 \
  --batch-size 1 \
  --calibration-file artifacts/calibration/weave-v1-calibration-sample.json \
  --calibration-example-limit 4 \
  --error-report-file artifacts/reports/weave-holdout-anchors-2026-06-17-smoke-error-report.json
```

Setup:

- Model path: backend Bedrock grading evaluator.
- Model ID: `us.anthropic.claude-opus-4-8`.
- Region: `us-east-1`.
- Chat/session shape: one model call per interview (`--batch-size 1`).
- Loaded labeled cases: 10.
- Excluded out-of-scale labels: 2.
- Evaluated held-out cases: 8.
- Calibration examples loaded from `weave-v1-calibration-sample.json`: 8.

Aggregate result:

| Metric | Value |
| --- | ---: |
| Mean absolute error | 0.65625 |
| Exact score rate | 0.125 |
| Within 0.5 rate | 0.65625 |

Per-dimension result:

| Dimension | MAE | Exact | Within 0.5 |
| --- | ---: | ---: | ---: |
| Problem Solving | 0.5625 | 0.125 | 0.875 |
| Agency | 0.5 | 0.25 | 0.75 |
| Competitiveness | 0.8125 | 0 | 0.5 |
| Curious | 0.75 | 0.125 | 0.5 |

Observation:

The prompt is useful but still too conservative on high-end candidates. The
largest disagreements under-score strong human labels, especially
competitiveness and curiosity. Next calibration work should add stronger
answer-level anchors for 3.5/4 outcomes and explicit instructions that lived,
specific, high-cost stories should not be compressed down to 2.5/3.

## 2026-06-18 GPT-5.5 High-Effort Smoke Run

Command:

```bash
corepack pnpm@9.12.0 grading:evaluate:connected -- \
  --organization-id org_01KV4FF7KX24B76H7Q57QVB5CT \
  --limit 3 \
  --batch-size 1 \
  --calibration-file artifacts/calibration/weave-v1-calibration-sample.json \
  --calibration-example-limit 4 \
  --model-provider openai \
  --model-id gpt-5.5 \
  --openai-reasoning-effort high \
  --openai-verbosity low \
  --error-report-file artifacts/reports/weave-holdout-gpt-5p5-high-2026-06-18-parserfix-smoke-error-report.json
```

Setup:

- Model path: OpenAI Responses grading evaluator.
- Model ID: `gpt-5.5`.
- Reasoning effort: `high`.
- Text verbosity: `low`.
- Chat/session shape: one model call per interview (`--batch-size 1`).
- Loaded labeled cases: 3.
- Evaluated held-out cases: 3.
- Calibration examples loaded from `weave-v1-calibration-sample.json`: 8.
- AWS secret deployed at `/puddle-videoagent/providers/openai-api-key`.

Aggregate result:

| Metric | Value |
| --- | ---: |
| Mean absolute error | 0.4166666667 |
| Exact score rate | 0.3333333333 |
| Within 0.5 rate | 0.8333333333 |

Per-dimension result:

| Dimension | MAE | Exact | Within 0.5 |
| --- | ---: | ---: | ---: |
| Problem Solving | 0.6666666667 | 0 | 0.6666666667 |
| Agency | 0.3333333333 | 0.3333333333 | 1 |
| Competitiveness | 0.1666666667 | 0.6666666667 | 1 |
| Curious | 0.5 | 0.3333333333 | 0.6666666667 |

Observation:

The first GPT smoke exposed a parser reliability issue: GPT sometimes omitted
`scripted_answer_detection.summary` and `scripted_answer_detection.confidence`.
The parser now defaults those secondary metadata fields with warnings instead
of failing the scorecard. After that fix, all 3 smoke cases parsed.

The model is meaningfully better than the Bedrock smoke on this tiny overlapping
set, especially on competitiveness. It still under-scores some high-end Problem
Solving and Curious labels, so the next calibration pass should add stronger 4
anchors for deeply novel technical work and top-percentile niche expertise.

## 2026-06-18 GPT-5.5 Full Holdout Baseline

Command:

```bash
corepack pnpm@9.12.0 grading:evaluate:connected -- \
  --organization-id org_01KV4FF7KX24B76H7Q57QVB5CT \
  --limit 100 \
  --batch-size 5 \
  --calibration-file artifacts/calibration/weave-v1-calibration-sample.json \
  --calibration-example-limit 8 \
  --model-provider openai \
  --model-id gpt-5.5 \
  --openai-reasoning-effort high \
  --openai-verbosity low \
  --model-call-timeout-ms 600000 \
  --error-report-file artifacts/reports/weave-full-gpt-5p5-high-2026-06-18-run5-error-report.json
```

Setup:

- Chat/session shape: one model call per interview. `--batch-size 5` only
  controls concurrent independent requests.
- Loaded labeled cases: 96.
- Excluded calibration cases: 8.
- Excluded out-of-scale labels: 4.
- Evaluated held-out cases: 84.
- Successful scorecards: 72.
- Failed scorecards: 12, mostly provider/request failures around the long-call
  ceiling.

Aggregate result over successful cases:

| Metric | Value |
| --- | ---: |
| Mean absolute error | 0.5416666667 |
| Exact score rate | 0.3472222222 |
| Within 0.5 rate | 0.6979166667 |

Per-dimension result:

| Dimension | MAE | Exact | Within 0.5 |
| --- | ---: | ---: | ---: |
| Problem Solving | 0.4583333333 | 0.3888888889 | 0.75 |
| Agency | 0.5625 | 0.3611111111 | 0.6527777778 |
| Competitiveness | 0.6041666667 | 0.2916666667 | 0.6805555556 |
| Curious | 0.5416666667 | 0.3472222222 | 0.7083333333 |

Bias observation:

The model still compresses high scores downward. Across successful cases, the
mean total-score delta was -1.0. On human 3.5/4 labels, mean deltas were -0.875
for Problem Solving, -0.891 for Competitiveness, and -0.808 for Curious.

## 2026-06-18 GPT-5.5 Calibrated Lean Full Holdout

Command:

```bash
corepack pnpm@9.12.0 grading:evaluate:connected -- \
  --organization-id org_01KV4FF7KX24B76H7Q57QVB5CT \
  --limit 100 \
  --batch-size 5 \
  --calibration-file artifacts/calibration/weave-v1-calibration-sample.json \
  --calibration-example-limit 8 \
  --calibration-transcript-max-chars 0 \
  --model-provider openai \
  --model-id gpt-5.5 \
  --openai-reasoning-effort high \
  --openai-verbosity low \
  --model-call-timeout-ms 600000 \
  --error-report-file artifacts/reports/weave-full-gpt-5p5-high-2026-06-18-run6-calibrated-lean-error-report.json
```

Prompt changes:

- Added explicit anti-compression grading guidance.
- Clarified that 4s do not require public validation or credentials when the
  transcript has concrete high-end evidence.
- Replaced the abstract Problem Solving 4 anchor with a concrete high-end
  frontier-agent/reasoning pattern.
- Kept full calibration examples score/rationale oriented by setting transcript
  excerpt length to zero for the evaluation run.

Aggregate result over successful cases:

| Metric | Value |
| --- | ---: |
| Successful scorecards | 83 / 84 |
| Mean absolute error | 0.5436746988 |
| Exact score rate | 0.343373494 |
| Within 0.5 rate | 0.6927710843 |

Per-dimension result:

| Dimension | MAE | Exact | Within 0.5 |
| --- | ---: | ---: | ---: |
| Problem Solving | 0.4397590361 | 0.3975903614 | 0.7710843373 |
| Agency | 0.5722891566 | 0.3614457831 | 0.6506024096 |
| Competitiveness | 0.5301204819 | 0.3012048193 | 0.7469879518 |
| Curious | 0.6325301205 | 0.313253012 | 0.6024096386 |

One failed case succeeded on a same-prompt single-session retry. Combined with
the retry, coverage was 84 / 84 and aggregate MAE was 0.5476190476.

Conclusion:

The calibrated lean setup materially improved operational reliability, reducing
failures from 12 to 1 on the full holdout, while keeping accuracy roughly flat.
It improved Problem Solving and Competitiveness but worsened Curious. Next
calibration should focus on answer-level Curious and Agency anchors and likely a
small adjudicated set of largest disagreements, rather than more generic prompt
language.
