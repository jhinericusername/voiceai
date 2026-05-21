"""Calibration run: replay the corpus, compute agreement, write the report."""

from __future__ import annotations

from pathlib import Path

from agent.domain.types import Rubric
from agent.eval.corpus import load_corpus
from agent.eval.metrics import AgreementReport, compute_agreement
from agent.eval.replay import replay_corpus
from agent.scoring.scorer import Scorer


def run_calibration(
    scorer: Scorer,
    rubric: Rubric,
    corpus_dir: Path,
    report_path: Path,
    pass_threshold_within_one: float,
) -> AgreementReport:
    """Replay the corpus through the Scorer and write a calibration report.

    Returns the `AgreementReport`; also serializes it to `report_path` as JSON.
    """
    corpus = load_corpus(corpus_dir)
    results = replay_corpus(scorer, rubric, corpus)
    report = compute_agreement(results, pass_threshold_within_one)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(report.model_dump_json(indent=2))
    return report


def main() -> None:  # pragma: no cover — CLI entrypoint
    """CLI: run calibration against `corpus/` using the pilot rubric."""
    import sys

    import anthropic

    from agent.rubric_loader import load_rubric

    repo_root = Path(__file__).parents[4]
    rubric = load_rubric(repo_root / "rubric" / "pilot-v1.yaml")
    scorer = Scorer(client=anthropic.Anthropic(), rubric=rubric)
    report = run_calibration(
        scorer=scorer,
        rubric=rubric,
        corpus_dir=repo_root / "corpus",
        report_path=repo_root / "corpus" / "calibration_report.json",
        pass_threshold_within_one=0.85,
    )
    print(f"within_one_rate={report.within_one_rate:.3f} passes={report.passes}")
    sys.exit(0 if report.passes else 1)


if __name__ == "__main__":  # pragma: no cover
    main()
