"""Score-agreement metrics for the eval harness."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from agent.eval.replay import ReplayResult


class CategoryAgreement(BaseModel):
    """Agreement metrics for one rubric category across the corpus."""

    model_config = ConfigDict(frozen=True)

    category: str
    n: int
    exact_match_rate: float
    within_one_rate: float
    correlation: float


class AgreementReport(BaseModel):
    """The full agreement report vs. the human-scored corpus."""

    model_config = ConfigDict(frozen=True)

    n_pairs: int
    exact_match_rate: float
    within_one_rate: float
    per_category: dict[str, CategoryAgreement]
    pass_threshold_within_one: float
    passes: bool


def _pearson(xs: list[float], ys: list[float]) -> float:
    """Pearson correlation; 0.0 when variance is zero or n < 2."""
    n = len(xs)
    if n < 2:
        return 0.0
    mx = sum(xs) / n
    my = sum(ys) / n
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=True))
    vx = sum((x - mx) ** 2 for x in xs)
    vy = sum((y - my) ** 2 for y in ys)
    if vx == 0 or vy == 0:
        return 0.0
    return cov / (vx**0.5 * vy**0.5)


def _pairs(results: list[ReplayResult]) -> list[tuple[str, int, int]]:
    """Flatten results into (category, machine_score, human_score) triples."""
    out: list[tuple[str, int, int]] = []
    for result in results:
        for category, machine in result.machine_scores.items():
            if category in result.human_scores:
                out.append((category, machine, result.human_scores[category]))
    return out


def compute_agreement(
    results: list[ReplayResult], pass_threshold_within_one: float
) -> AgreementReport:
    """Compute overall and per-category agreement against human scores."""
    pairs = _pairs(results)
    n = len(pairs)
    exact = sum(1 for _, m, h in pairs if m == h)
    within_one = sum(1 for _, m, h in pairs if abs(m - h) <= 1)
    exact_rate = exact / n if n else 0.0
    within_one_rate = within_one / n if n else 0.0

    per_category: dict[str, CategoryAgreement] = {}
    categories = {cat for cat, _, _ in pairs}
    for category in sorted(categories):
        cat_pairs = [(m, h) for c, m, h in pairs if c == category]
        cn = len(cat_pairs)
        cat_exact = sum(1 for m, h in cat_pairs if m == h)
        cat_within = sum(1 for m, h in cat_pairs if abs(m - h) <= 1)
        per_category[category] = CategoryAgreement(
            category=category,
            n=cn,
            exact_match_rate=cat_exact / cn if cn else 0.0,
            within_one_rate=cat_within / cn if cn else 0.0,
            correlation=_pearson(
                [float(m) for m, _ in cat_pairs], [float(h) for _, h in cat_pairs]
            ),
        )

    return AgreementReport(
        n_pairs=n,
        exact_match_rate=exact_rate,
        within_one_rate=within_one_rate,
        per_category=per_category,
        pass_threshold_within_one=pass_threshold_within_one,
        passes=within_one_rate >= pass_threshold_within_one,
    )
