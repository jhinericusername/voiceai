"use client";

import { useState } from "react";

const evaluationViews = [
  {
    label: "Scorecard",
    title: "Rubric notes tied to your criteria",
    detail: "Every screen becomes dimension-level observations with notes that explain the review.",
  },
  {
    label: "Coverage",
    title: "Required prompts are checked",
    detail: "The report records whether the interviewer asked the role-specific questions your team cares about.",
  },
  {
    label: "Authenticity",
    title: "Cheating risk is separated from quality",
    detail: "Puddle flags scripted answers, AI assistance risk, buzzword density, and follow-up resilience.",
  },
  {
    label: "Decision",
    title: "A concise final hiring signal",
    detail: "Reviewers get rubric notes, authenticity context, and the reason to continue or pass.",
  },
];

const scorecardRows = [
  {
    dimension: "Systems reasoning",
    score: 3,
    note: "Prakul isolated the failure to queue fan-out, named retry and idempotency risks, and proposed audit logging before being prompted. He needed one follow-up to quantify throughput thresholds.",
  },
  {
    dimension: "Ownership",
    score: 2,
    note: "He took a half-scoped onboarding bug from reproduction to shipped fix, including migration notes and reviewer signoff. The follow-through was clear, but the example stayed narrow.",
  },
  {
    dimension: "Product judgment",
    score: 3,
    note: "He tied consent copy, auth states, and room readiness to candidate trust, then chose a smaller launch path over rebuilding the ATS flow. One reviewer-calibration tradeoff came late.",
  },
  {
    dimension: "Communication clarity",
    score: 4,
    note: "He gave compact answers with concrete timestamps, tools, constraints, and outcomes. Follow-ups were direct, and the final root-cause explanation was easy to quote in reviewer notes.",
  },
];

const coverageQuestions = [
  "Production debugging walkthrough",
  "Ambiguous ownership example",
  "Product tradeoff over code elegance",
  "Clear root-cause explanation",
];

const authenticitySignals = [
  { signal: "Scripted likelihood", rating: "Low" },
  { signal: "Live AI assistance", rating: "Very low" },
  { signal: "Buzzword density", rating: "Medium-low" },
  { signal: "Conversational authenticity", rating: "High" },
  { signal: "Follow-up resilience", rating: "Low" },
];

const totalScore = scorecardRows.reduce((total, row) => total + row.score, 0);
const maxScore = scorecardRows.length * 4;

export function SampleReportClient({ variant = "page" }: { readonly variant?: "page" | "landing" }) {
  const [active, setActive] = useState(0);
  const view = evaluationViews[active];
  const isLanding = variant === "landing";
  const eyebrow = isLanding ? "Review packet" : "Sample report";
  const title = isLanding ? "Every recommendation shows its work." : "Prakul Singh - candidate review packet";
  const description = isLanding
    ? "Puddle converts a 10-minute video interview into a role-specific review packet: rubric observations, question coverage, authenticity signals, and the evidence behind the final recommendation."
    : "A role-specific report showing rubric observations, question coverage, authenticity signals, and the evidence behind the final recommendation.";

  return (
    <section
      id={isLanding ? "review-packet" : undefined}
      className={
        isLanding
          ? "puddle-grid-band relative z-10 scroll-mt-24 overflow-hidden border-y border-slate-200 px-5 py-16 sm:px-6 md:py-20"
          : "puddle-grid-band relative z-10 overflow-hidden border-b border-slate-200 px-5 pb-20 pt-32 sm:px-6 lg:pt-36"
      }
    >
      <div className="relative z-10 mx-auto max-w-7xl">
        <div className="mx-auto max-w-[92vw] text-center xl:max-w-[75vw]">
          <span className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-700">{eyebrow}</span>
          {isLanding ? (
            <h2 className="mt-4 text-3xl font-semibold leading-tight text-slate-950 md:text-5xl xl:whitespace-nowrap">
              {title}
            </h2>
          ) : (
            <h1 className="mt-4 text-3xl font-semibold leading-tight text-slate-950 md:text-5xl xl:whitespace-nowrap">
              {title}
            </h1>
          )}
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-slate-600">{description}</p>
        </div>

        <div className="mx-auto mt-8 grid max-w-5xl items-stretch gap-2 rounded-lg border border-slate-200 bg-white/88 p-2 shadow-[0_18px_56px_rgba(15,23,42,0.06)] backdrop-blur sm:grid-cols-2 lg:grid-cols-4">
          {evaluationViews.map((evaluationView, index) => (
            <button
              key={evaluationView.label}
              type="button"
              aria-pressed={active === index}
              onClick={() => setActive(index)}
              className={`grid min-h-28 grid-rows-[1.5rem_3rem] content-center gap-2 rounded-md border px-4 py-3 text-left transition ${
                active === index
                  ? "border-cyan-300 bg-cyan-50 shadow-[0_10px_24px_rgba(14,116,144,0.1)]"
                  : "border-transparent bg-transparent hover:border-slate-200 hover:bg-white"
              }`}
            >
              <div className="flex items-center justify-between gap-4 self-center">
                <span className="text-sm font-semibold text-slate-950">{evaluationView.label}</span>
                <span className={active === index ? "text-xs font-semibold text-cyan-800" : "text-xs text-slate-400"}>
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <p className="self-center text-sm leading-6 text-slate-600">{evaluationView.title}</p>
            </button>
          ))}
        </div>

        <div className="mx-auto mt-8 max-w-6xl">
          <ScorecardArtifact active={active} view={view} />
        </div>
      </div>
    </section>
  );
}

function ScorecardArtifact({
  active,
  view,
}: {
  readonly active: number;
  readonly view: (typeof evaluationViews)[number];
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.12)]">
      <div className="flex flex-col gap-4 border-b border-slate-200 bg-white px-5 py-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700">10-minute screen output</div>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">Scorecard for Prakul Singh</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            A rubric-specific report with enough evidence for the hiring manager to agree, disagree, or replay the
            original answer.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center sm:min-w-72">
          {[
            { label: "Score", value: `${totalScore}/${maxScore}` },
            { label: "AI risk", value: "10%" },
            { label: "Coverage", value: "4/4" },
          ].map((metric) => (
            <div key={metric.label} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-lg font-semibold text-slate-950">{metric.value}</div>
              <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{metric.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-[1.55fr_0.75fr]">
        <div className="border-b border-slate-200 lg:border-b-0 lg:border-r">
          <div className="grid border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <div>Dimension</div>
            <div className="hidden sm:block">Evidence note</div>
          </div>

          {scorecardRows.map((row) => (
            <div
              key={row.dimension}
              className="grid gap-3 border-b border-slate-100 px-5 py-4 last:border-b-0 sm:grid-cols-[12rem_minmax(0,1fr)]"
            >
              <div className="flex items-center justify-between gap-3 sm:block">
                <div className="text-sm font-semibold text-slate-950">{row.dimension}</div>
                <span className="inline-flex h-8 min-w-12 items-center justify-center rounded-md bg-cyan-50 px-2 text-sm font-semibold text-cyan-900 sm:mt-3">
                  {row.score} / 4
                </span>
              </div>
              <p className="text-sm leading-6 text-slate-600">{row.note}</p>
            </div>
          ))}
        </div>

        <div className="border-t border-slate-200 bg-gradient-to-b from-cyan-50/70 via-white to-slate-50 lg:border-l lg:border-t-0">
          <div className="border-b border-slate-200 px-5 py-5">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700">{view.label}</div>
            <h3 className="mt-2 text-2xl font-semibold text-slate-950">{view.title}</h3>
            <p className="mt-3 text-sm leading-6 text-slate-600">{view.detail}</p>
          </div>

          <div className="px-5 py-5">
            <ScorecardFocusPanel active={active} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ScorecardFocusPanel({ active }: { readonly active: number }) {
  if (active === 1) {
    return (
      <div className="grid gap-3">
        {coverageQuestions.map((question) => (
          <div key={question} className="flex items-start justify-between gap-4 border-b border-slate-200 pb-3 last:border-b-0 last:pb-0">
            <span className="text-sm leading-6 text-slate-700">{question}</span>
            <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">
              Asked
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (active === 2) {
    return (
      <div className="grid gap-3">
        {authenticitySignals.map((signal) => (
          <div key={signal.signal} className="flex items-center justify-between gap-4 border-b border-slate-200 pb-3 last:border-b-0 last:pb-0">
            <span className="text-sm text-slate-600">{signal.signal}</span>
            <span className="text-sm font-semibold text-slate-950">{signal.rating}</span>
          </div>
        ))}
        <div className="mt-2 rounded-md border border-cyan-100 bg-cyan-50 px-3 py-3 text-sm leading-6 text-cyan-900">
          Very low cheating risk. The imperfect pauses appeared during follow-up reasoning and matched the transcript,
          which reads as authentic rather than scripted.
        </div>
      </div>
    );
  }

  if (active === 3) {
    return (
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border border-slate-200 bg-white px-3 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Rubric signal</div>
            <div className="mt-1 text-xl font-semibold text-slate-950">Strong</div>
          </div>
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700">Recommendation</div>
            <div className="mt-1 text-xl font-semibold text-emerald-950">Advance</div>
          </div>
        </div>
        <p className="rounded-md border border-cyan-100 bg-cyan-50 px-3 py-3 text-sm leading-6 text-cyan-950">
          Advance to panel. Prakul shows strong communication, practical systems judgment, and low authenticity risk.
          Ownership scope is the main follow-up area for the next interviewer.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-end justify-between border-b border-slate-200 pb-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Final scores</div>
          <div className="mt-2 text-5xl font-semibold tracking-normal text-slate-950">{totalScore}</div>
        </div>
        <div className="pb-1 text-sm font-semibold text-slate-500">out of {maxScore}</div>
      </div>
      <div className="mt-4 grid gap-3">
        {scorecardRows.map((row) => (
          <div key={row.dimension} className="flex items-center justify-between gap-4">
            <span className="text-sm text-slate-600">{row.dimension}</span>
            <span className="text-sm font-semibold text-slate-950">{row.score} / 4</span>
          </div>
        ))}
      </div>
    </div>
  );
}
