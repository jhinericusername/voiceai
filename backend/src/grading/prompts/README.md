# Grading Prompt Assets

This folder contains versionable prompt data that should stay separate from
model-provider wiring.

## Dimension Score Anchors

`dimension-score-anchors.ts` defines anonymized answer-level anchors for each
integer score across the four Weave dimensions:

- `problem_solving`
- `agency`
- `competitiveness`
- `curious`

These anchors are not full candidate calibration examples. They teach the model
what `1`, `2`, `3`, and `4` look like for one dimension at a time.

Current seed anchors were derived from local Weave calibration artifacts and
user-provided scored examples. They are intentionally short and anonymized so
the live scorer can include them in every single-interview prompt without
pulling raw historical transcripts at request time.

When we export stronger examples from the DB, replace individual anchors in
place while keeping the public shape stable:

```ts
{
  id,
  source,
  score,
  label,
  answerExcerpt,
  whyThisScore,
}
```

Do not use missing-question neutral defaults as anchors. A score anchor should
represent an actual answer to the relevant prompt.
