"""Guardrail monitor: off-path output-turn watcher using a cheap Haiku classifier.

After the realtime model speaks, the runner sends the agent's text here.
The monitor classifies whether the turn fabricated facts, made commitments,
leaked scoring, or touched protected topics.  On a violation the runner
injects a correction.

Fail-open: any error (network, bad JSON, missing keys) returns a no-violation
verdict so the interview is never crashed by a guardrail miss.
"""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, ConfigDict

_SYSTEM_PROMPT = """\
You are a guardrail classifier for an AI interviewer at Weave. After the interviewer speaks a turn, classify whether the turn contains any of the following violations:

1. fabrication — the interviewer invented or asserted facts about the company, team, role, process, or any factual detail it was not given. ALLOWED (not a violation): saying compensation is open to negotiation / the posting reflects current pay / pointing to Andrew for specifics; saying start dates are flexible and handled with Andrew and Adam; the approved Weave facts (what Weave does, ~15 people / ~10 engineers, startups→enterprise, hiring, the take-home→interviews→work-trial process).
2. commitment — a promise or guarantee beyond the approved process (e.g. "you will definitely get an offer"). Stating the approved next steps is NOT a violation.
3. protected — asked about or acknowledged a protected-class topic (age, race, gender, religion, nationality, disability, family/pregnancy status, sexual orientation, etc.).
4. comp_specific — quoted a SPECIFIC salary number or equity figure (this IS a violation).
5. scoring_leak — revealed or hinted at the candidate's score, the rubric, or how they are evaluated (this IS a violation).
6. off_script — steered significantly off the interview script without cause.
7. none — no violation detected.

Return STRICT JSON only — no prose, no markdown:
{"violation": <true|false>, "kind": <"fabrication"|"commitment"|"protected"|"comp_specific"|"scoring_leak"|"off_script"|"none">, "correction": <"short corrective instruction to the interviewer, or empty string if no violation">}

When violation is false, set kind to "none" and correction to "".
"""


class GuardrailVerdict(BaseModel):
    """Result of a single guardrail check."""

    model_config = ConfigDict(frozen=True)

    violation: bool
    kind: str  # "fabrication" | "off_script" | "commitment" | "protected" | "none"
    correction: str  # injected steering text when violation else ""


_SAFE_VERDICT = GuardrailVerdict(violation=False, kind="none", correction="")


class GuardrailMonitor:
    """Sync guardrail classifier; runner bridges via asyncio.to_thread."""

    def __init__(self, client: Any, model: str) -> None:  # noqa: ANN401 — injected SDK client
        self._client = client
        self._model = model

    def check_turn(self, agent_text: str) -> GuardrailVerdict:
        """Classify one interviewer turn; fail-open on any error.

        Args:
            agent_text: The verbatim text spoken by the interviewer.

        Returns:
            GuardrailVerdict — violation=False on any error (fail-open).
        """
        try:
            response = self._client.messages.create(
                model=self._model,
                max_tokens=256,
                system=_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": agent_text}],
            )
            text = "".join(block.text for block in response.content)
        except Exception:  # noqa: BLE001 — fail-open: never crash the interview
            return _SAFE_VERDICT
        return self._parse(text)

    def _parse(self, text: str) -> GuardrailVerdict:
        """Parse the model's JSON response defensively; return safe verdict on failure."""
        try:
            start = text.find("{")
            end = text.rfind("}")
            if start == -1 or end == -1 or end < start:
                return _SAFE_VERDICT
            payload = json.loads(text[start : end + 1])
            violation = bool(payload["violation"])
            kind = str(payload["kind"])
            correction = str(payload.get("correction", ""))
            return GuardrailVerdict(violation=violation, kind=kind, correction=correction)
        except Exception:  # noqa: BLE001 — fail-open
            return _SAFE_VERDICT
