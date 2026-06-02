"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { PublicFooter } from "./PublicFooter";
import { PublicNav } from "./PublicNav";
import { SampleReportClient } from "./sample-report/SampleReportClient";

const customerLogos = [
  { label: "YC", src: "/logos/customers/y-combinator.svg", width: 64, height: 64, className: "h-10 sm:h-11" },
  { label: "Pear VC", src: "/logos/customers/pear-vc.svg", width: 72, height: 56, className: "h-14 sm:h-16" },
  {
    label: "Telora",
    src: "/logos/customers/telora.svg",
    width: 460,
    height: 460,
    className: "h-10 sm:h-12",
    wordmark: "Telora",
  },
];

const heroArtifacts = [
  {
    kind: "rubric",
    stage: "Hiring bar",
  },
  {
    kind: "screen",
    stage: "Puddle screen",
  },
  {
    kind: "packet",
    stage: "Reviewer output",
  },
] as const;

type HeroArtifact = (typeof heroArtifacts)[number];

const howItWorksSteps = [
  {
    kind: "rubric",
    stage: "Hiring bar",
    title: "Turn the role brief into a measurable standard",
    detail:
      "Puddle converts the role brief into rubric dimensions, signal criteria, and examples your team can calibrate against.",
    badge: "Bar set",
    proof: ["Rubric dimensions", "Strong and weak evidence", "Role-specific probes"],
  },
  {
    kind: "screen",
    stage: "Puddle screen",
    title: "Run a focused screen against the bar",
    detail:
      "The interviewer asks role-linked questions, captures the recording and transcript, and follows up when an answer needs more signal.",
    badge: "Screen live",
    proof: ["10-minute screen", "Transcript capture", "Adaptive follow-ups"],
  },
  {
    kind: "packet",
    stage: "Reviewer output",
    title: "Hand the panel evidence, not hunches",
    detail:
      "Reviewers get the recommendation, confidence, timestamps, rubric notes, and the reason behind the next action.",
    badge: "Ready to review",
    proof: ["Recommendation", "Timestamped evidence", "Reviewer action"],
  },
] as const;

function useLandingReveal() {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.14, rootMargin: "0px 0px -8% 0px" },
    );

    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);
}

export default function HomeClient() {
  useLandingReveal();

  return (
    <main className="puddle-page min-h-svh text-slate-950">
      <PublicNav homeHref="#top" />
      <div className="puddle-hero-frame">
        <HeroSection />
      </div>
      <ProofStrip />
      <WorkflowSection />
      <SampleReportClient variant="landing" />
      <FinalCta />
    </main>
  );
}

function HeroSection() {
  return (
    <section id="top" className="relative z-10 px-5 pb-10 pt-28 sm:px-6 lg:pb-12 lg:pt-32">
      <div className="mx-auto max-w-7xl">
        <div data-reveal className="mx-auto max-w-5xl text-center">
          <div className="puddle-hero-kicker inline-flex items-center gap-2 rounded-md border border-cyan-200 bg-cyan-50/90 px-3 py-1.5 text-sm font-semibold text-cyan-900 shadow-[0_12px_34px_rgba(8,145,178,0.1)] backdrop-blur">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Technical hiring infrastructure
          </div>

          <h1 className="mx-auto mt-6 max-w-5xl text-4xl font-semibold leading-[1.02] tracking-normal text-slate-950 sm:text-5xl lg:text-7xl">
            Turn engineering hiring into an evidence-backed system.
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-slate-600">
            Puddle helps teams define role-specific rubrics, run structured AI video screens, and review candidates
            through recordings, transcripts, and rubric-backed evidence.
          </p>

          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <a
              href="mailto:hello@usepuddle.com"
              className="inline-flex min-h-12 items-center justify-center rounded-md bg-slate-950 px-6 text-base font-semibold !text-white shadow-[0_18px_46px_rgba(15,23,42,0.2)] transition hover:-translate-y-0.5 hover:bg-slate-800"
            >
              Book a pilot
            </a>
            <a
              href="#system"
              className="inline-flex min-h-12 items-center justify-center rounded-md border border-slate-300 bg-white px-6 text-base font-semibold !text-slate-900 transition hover:-translate-y-0.5 hover:border-slate-400"
            >
              See the process
            </a>
          </div>
        </div>

        <div
          data-reveal
          className="mx-auto mt-12 max-w-6xl rounded-lg border border-slate-200 bg-white px-5 py-5 shadow-[0_22px_70px_rgba(15,23,42,0.06)] sm:px-6 lg:py-6"
        >
          <div className="border-b border-slate-200 pb-4 text-center">
            <p className="text-xl font-semibold leading-7 text-slate-950">From hiring bar to review packet.</p>
          </div>

          <div className="mt-5 grid gap-0 lg:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)_7rem_minmax(0,1fr)] lg:items-center">
            {heroArtifacts.map((artifact, index) => (
              <FragmentedArtifactFlow key={artifact.kind} artifact={artifact} showConnector={index < heroArtifacts.length - 1} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FragmentedArtifactFlow({ artifact, showConnector }: { artifact: HeroArtifact; showConnector: boolean }) {
  return (
    <>
      <div className="min-w-0">
        <ArtifactPreview kind={artifact.kind} />
        <div className="mt-5 text-center">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">{artifact.stage}</div>
        </div>
      </div>

      {showConnector ? (
        <>
          <div
            aria-hidden="true"
            className={`puddle-flow-connector puddle-flow-connector--mobile puddle-flow-connector--${artifact.kind} mx-auto my-4 lg:hidden`}
          >
            <span className="puddle-flow-connector-track" />
          </div>
          <div
            aria-hidden="true"
            className={`puddle-flow-connector puddle-flow-connector--desktop puddle-flow-connector--${artifact.kind} hidden -translate-y-3 items-center justify-center lg:flex`}
          >
            <span className="puddle-flow-connector-track" />
            <span className="puddle-flow-connector-head" />
          </div>
        </>
      ) : null}
    </>
  );
}

function ArtifactPreview({ kind }: { kind: HeroArtifact["kind"] }) {
  if (kind === "rubric") {
    return (
      <div className="puddle-artifact-preview puddle-artifact-preview--rubric flex h-36 items-center rounded-lg border border-slate-200 bg-slate-50 p-2">
        <div className="w-full rounded-md border border-slate-200 bg-white p-3 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-950">Role rubric</div>
            <div className="rounded-sm bg-cyan-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-700">
              Set
            </div>
          </div>
          <div className="mt-3 grid gap-2">
            {["Technical depth", "Collaboration", "AI fluency"].map((item) => (
              <div key={item} className="grid gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="puddle-rubric-dot h-2 w-2 rounded-full bg-cyan-500" />
                  <span className="text-xs font-medium text-slate-700">{item}</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100">
                  <div className="puddle-rubric-fill h-full w-3/4 rounded-full bg-slate-300" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (kind === "screen") {
    return (
      <div className="puddle-artifact-preview puddle-artifact-preview--screen flex h-36 items-center rounded-lg border border-slate-200 bg-slate-50 p-2">
        <div className="w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
          <div className="bg-slate-950 p-3 text-white">
            <div className="flex items-center justify-between">
              <span className="rounded-sm bg-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100">
                Live screen
              </span>
              <span className="text-[11px] text-white/55">10 min</span>
            </div>
            <div className="mt-4 flex items-center justify-center">
              <div className="puddle-screen-avatar flex h-10 w-10 items-center justify-center rounded-md bg-white/12 text-xl font-semibold">P</div>
            </div>
          </div>
          <div className="grid gap-1.5 p-2.5">
            <div className="puddle-screen-line h-2 w-full rounded-full bg-slate-200" />
            <div className="puddle-screen-line h-2 w-4/5 rounded-full bg-slate-200" />
            <div className="puddle-screen-line h-2 w-2/3 rounded-full bg-cyan-100" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="puddle-artifact-preview puddle-artifact-preview--packet h-36 rounded-lg border border-slate-200 bg-slate-50 p-2">
      <div className="relative h-full">
        <div className="absolute inset-x-4 top-0 h-16 rounded-md border border-slate-200 bg-white" />
        <div className="absolute inset-x-2 top-2 h-16 rounded-md border border-slate-200 bg-white" />
        <div className="absolute inset-x-0 top-4 rounded-md border border-slate-200 bg-white p-2 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-950">Candidate packet</div>
            <span className="puddle-packet-status h-2 w-2 rounded-full bg-emerald-500" />
          </div>
          <div className="mt-1.5 grid gap-1">
            {["Recommendation", "Transcript", "Rubric notes", "Build evidence"].map((item) => (
              <div key={item} className="puddle-packet-row flex items-center justify-between gap-3 rounded-sm border border-slate-100 px-2 py-px">
                <span className="text-[9px] font-medium text-slate-600">{item}</span>
                <span className="h-1 w-7 rounded-full bg-slate-200" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProofStrip() {
  return (
    <section className="puddle-logo-strip relative z-10 px-5 pb-10 pt-9 sm:px-6 md:pb-12">
      <div data-reveal className="mx-auto max-w-7xl">
        <p className="text-center text-base font-semibold text-slate-700 sm:text-lg">
          Trusted by the next generation of companies.
        </p>

        <div className="mx-auto mt-7 grid max-w-3xl grid-cols-2 items-center gap-x-10 gap-y-7 sm:grid-cols-3">
          {customerLogos.map((logo, index) => (
            <div
              key={logo.label}
              className={`flex min-h-14 items-center justify-center ${
                index === customerLogos.length - 1 ? "col-span-2 sm:col-span-1" : ""
              }`}
            >
              <Image
                src={logo.src}
                alt={logo.label}
                width={logo.width}
                height={logo.height}
                className={`w-auto object-contain opacity-90 ${logo.className}`}
              />
              {"wordmark" in logo ? (
                <span
                  className="ml-2 text-2xl font-medium text-slate-500 sm:text-3xl"
                  style={{ fontFamily: "Poppins, Avenir Next, 'Segoe UI', Helvetica, Arial, sans-serif" }}
                >
                  {logo.wordmark}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WorkflowSection() {
  const [workflowProgress, setWorkflowProgress] = useState(0);
  const stepCount = howItWorksSteps.length;
  const activeStep = Math.min(stepCount - 1, Math.max(0, Math.floor(workflowProgress * stepCount)));
  const stepPosition = workflowProgress * stepCount - 0.5;
  const getStepAnchorProgress = (index: number) => (index + 0.5) / stepCount;

  useEffect(() => {
    const section = document.querySelector<HTMLElement>("#system");
    if (!section) return;

    let frame: number | null = null;

    const updateActiveStep = () => {
      const rect = section.getBoundingClientRect();
      const scrollDistance = Math.max(rect.height - window.innerHeight, 1);
      const progress = Math.min(1, Math.max(0, -rect.top / scrollDistance));

      setWorkflowProgress((currentProgress) => (Math.abs(currentProgress - progress) < 0.002 ? currentProgress : progress));
    };

    const scheduleUpdate = () => {
      if (frame !== null) return;

      frame = window.requestAnimationFrame(() => {
        frame = null;
        updateActiveStep();
      });
    };

    updateActiveStep();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, []);

  const getCrossfadeStyle = (index: number) => {
    const fadeWidth = 0.04;
    const segmentStart = index / stepCount;
    const segmentEnd = (index + 1) / stepCount;
    const isFirst = index === 0;
    const isLast = index === stepCount - 1;
    let rawOpacity = 1;

    if (!isFirst && workflowProgress < segmentStart - fadeWidth) {
      rawOpacity = 0;
    } else if (!isFirst && workflowProgress < segmentStart + fadeWidth) {
      rawOpacity = (workflowProgress - (segmentStart - fadeWidth)) / (fadeWidth * 2);
    } else if (!isLast && workflowProgress > segmentEnd + fadeWidth) {
      rawOpacity = 0;
    } else if (!isLast && workflowProgress > segmentEnd - fadeWidth) {
      rawOpacity = ((segmentEnd + fadeWidth) - workflowProgress) / (fadeWidth * 2);
    }

    rawOpacity = Math.max(0, Math.min(1, rawOpacity));
    const easedOpacity = rawOpacity * rawOpacity * (3 - 2 * rawOpacity);
    const opacity = easedOpacity < 0.06 ? 0 : easedOpacity;
    const offset = (index - stepPosition) * 10;

    return {
      opacity,
      transform: `translate3d(0, ${offset}px, 0) scale(${0.985 + opacity * 0.015})`,
      filter: `blur(${(1 - opacity) * 0.8}px)`,
      zIndex: Math.round(opacity * 10),
    };
  };

  return (
    <section
      id="system"
      className="relative z-10 scroll-mt-24 overflow-visible bg-white px-5 pb-16 pt-0 sm:px-6 md:pb-24 lg:min-h-[300vh] lg:pb-0"
    >
      <div className="relative z-10 mx-auto max-w-7xl pt-14 md:pt-16 lg:sticky lg:top-[60px] lg:flex lg:min-h-[calc(100svh-60px)] lg:flex-col lg:pb-6 lg:pt-8">
        <div data-reveal className="puddle-how-heading-shell relative mx-auto max-w-4xl text-center">
          <span className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-700">How it works</span>
          <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-normal text-slate-950 md:text-4xl">
            From hiring bar to reviewer output.
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-base leading-7 text-slate-600">
            Define the standard once, run every screen against it, and give reviewers the evidence trail behind the next
            decision.
          </p>
        </div>

        <div data-reveal className="mt-8 hidden gap-10 lg:grid lg:grid-cols-[0.76fr_1.24fr] lg:items-center">
          <div>
            <div className="relative min-h-[286px]">
              {howItWorksSteps.map((step, index) => (
                <div
                  key={step.stage}
                  className={`absolute inset-0 transition-[opacity,transform,filter] duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    activeStep === index ? "pointer-events-auto" : "pointer-events-none"
                  }`}
                  style={getCrossfadeStyle(index)}
                >
                  <HowItWorksStepCard
                    step={step}
                    index={index}
                    active={activeStep === index}
                    onMouseEnter={() => setWorkflowProgress(getStepAnchorProgress(index))}
                  />
                </div>
              ))}
            </div>

            <div className="mt-8 grid grid-cols-3 gap-2">
              {howItWorksSteps.map((step, index) => (
                <button
                  key={step.stage}
                  type="button"
                  onClick={() => setWorkflowProgress(getStepAnchorProgress(index))}
                  className={`rounded-md border px-3 py-2 text-left transition duration-500 ${
                    activeStep === index
                      ? "border-cyan-300 bg-cyan-50 text-cyan-950"
                      : "border-slate-200 bg-white/70 text-slate-500 hover:border-slate-300"
                  }`}
                >
                  <div className="text-xs font-semibold">{String(index + 1).padStart(2, "0")}</div>
                  <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em]">{step.stage}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="puddle-how-artifact-stage relative min-h-[440px]">
            {howItWorksSteps.map((step, index) => (
              <div
                key={step.stage}
                className={`absolute inset-0 transition-[opacity,transform,filter] duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  activeStep === index ? "pointer-events-auto" : "pointer-events-none"
                }`}
                style={getCrossfadeStyle(index)}
              >
                <HowItWorksArtifact step={step} activeStep={index} />
              </div>
            ))}
          </div>
        </div>

        <div data-reveal className="mt-10 grid gap-4 lg:hidden">
          {howItWorksSteps.map((step, index) => (
            <HowItWorksStepCard
              key={step.stage}
              step={step}
              index={index}
              active={activeStep === index}
              onMouseEnter={() => setWorkflowProgress(getStepAnchorProgress(index))}
              showArtifact
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorksStepCard({
  step,
  index,
  active,
  onMouseEnter,
  showArtifact = false,
}: {
  readonly step: (typeof howItWorksSteps)[number];
  readonly index: number;
  readonly active: boolean;
  readonly onMouseEnter: () => void;
  readonly showArtifact?: boolean;
}) {
  return (
    <article
      onMouseEnter={onMouseEnter}
      className={`puddle-how-step-card w-full rounded-lg border bg-white/86 p-5 shadow-[0_18px_56px_rgba(15,23,42,0.06)] backdrop-blur transition duration-300 lg:p-6 ${
        active ? "border-cyan-300 shadow-[0_24px_70px_rgba(8,145,178,0.12)]" : "border-slate-200 lg:opacity-80"
      }`}
    >
      <div className="flex items-start gap-4">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md border text-sm font-semibold transition ${
            active ? "border-cyan-300 bg-cyan-50 text-cyan-900" : "border-slate-200 bg-white text-slate-500"
          }`}
        >
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700">{step.stage}</div>
          <h3 className="mt-3 text-2xl font-semibold leading-8 text-slate-950">{step.title}</h3>
          <p className="mt-3 text-sm leading-6 text-slate-600">{step.detail}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-3">
        {step.proof.map((item) => (
          <div key={item} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
            {item}
          </div>
        ))}
      </div>

      {showArtifact ? (
        <div className="mt-5">
          <ArtifactPreview kind={step.kind} />
        </div>
      ) : null}
    </article>
  );
}

function HowItWorksArtifact({
  step,
  activeStep,
}: {
  readonly step: (typeof howItWorksSteps)[number];
  readonly activeStep: number;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-950 text-white shadow-[0_36px_110px_rgba(15,23,42,0.18)]">
      <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">Process output</div>
          <h3 className="mt-1.5 text-2xl font-semibold leading-tight">{step.stage}</h3>
        </div>
        <div className="rounded-md bg-emerald-300 px-3 py-2 text-sm font-semibold text-slate-950">{step.badge}</div>
      </div>

      <div key={step.stage} className="puddle-how-artifact-motion p-5">
        {step.kind === "rubric" ? <HiringBarArtifact /> : null}
        {step.kind === "screen" ? <PuddleScreenArtifact /> : null}
        {step.kind === "packet" ? <ReviewerOutputArtifact /> : null}
      </div>

      <div className="border-t border-white/10 px-5 py-4">
        <div className="grid grid-cols-3 gap-2">
          {howItWorksSteps.map((item, index) => (
            <div
              key={item.stage}
              className={`h-1.5 rounded-full transition ${index <= activeStep ? "bg-cyan-300" : "bg-white/10"}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function HiringBarArtifact() {
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 lg:grid-cols-[0.72fr_1.28fr]">
        <div className="rounded-lg border border-white/10 bg-white/[0.06] p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Role brief</div>
          <p className="mt-3 text-sm leading-6 text-slate-200">
            Backend engineer for infra-heavy product work. Strong signal comes from tradeoff reasoning, ownership, and
            clear debugging habits.
          </p>
        </div>

        <div className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">Hiring bar</div>
          <div className="mt-3 grid gap-2">
            {[
              ["Technical depth", "System tradeoffs and failure handling"],
              ["Ownership", "Drives ambiguous work without hiding risk"],
              ["AI fluency", "Uses agents with judgment and verification"],
            ].map(([label, detail]) => (
              <div key={label} className="rounded-md bg-slate-950/38 px-4 py-2.5">
                <div className="text-sm font-semibold text-white">{label}</div>
                <div className="mt-1 text-sm leading-5 text-slate-300">{detail}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-3 sm:grid-cols-3">
        {["Signal criteria", "Probe plan", "Review rubric"].map((item) => (
          <div key={item} className="rounded-md bg-white/[0.06] px-3 py-2.5 text-sm font-semibold text-cyan-100">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function PuddleScreenArtifact() {
  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.04]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="text-sm font-semibold text-white">Puddle screen</div>
        <div className="rounded-md bg-cyan-300 px-2.5 py-1 text-xs font-semibold text-slate-950">10 min</div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[1.08fr_0.92fr]">
        <div className="border-b border-white/10 p-4 lg:border-b-0 lg:border-r">
          <div className="rounded-lg bg-slate-950 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">Current probe</div>
            <p className="mt-3 text-xl font-semibold leading-tight text-white">
              Walk through the tradeoff you made when the first implementation failed.
            </p>
            <div className="mt-4 grid gap-2">
              {["Follow up on constraints", "Capture answer timestamp", "Check rubric coverage"].map((item) => (
                <div key={item} className="rounded-md border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-slate-200">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">Live capture</div>
          <div className="mt-3 grid gap-2.5">
            {[
              ["Recording", "On"],
              ["Transcript", "Streaming"],
              ["Coverage", "2 / 3 probes"],
              ["Follow-up", "Queued"],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4 rounded-md bg-white/[0.06] px-4 py-2.5">
                <span className="text-sm text-slate-300">{label}</span>
                <span className="text-sm font-semibold text-white">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewerOutputArtifact() {
  return (
    <div className="grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="grid gap-2.5">
        <div className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">Recommendation</div>
          <div className="mt-2 text-3xl font-semibold leading-none text-white">Meet</div>
        </div>

        {[
          ["Confidence", "High"],
          ["Evidence quality", "Strong"],
          ["Reviewer action", "Replay answers 2 and 4"],
        ].map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 rounded-md bg-white/[0.06] px-4 py-2.5">
            <span className="text-sm text-slate-300">{label}</span>
            <span className="text-right text-sm font-semibold text-white">{value}</span>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-white/10 p-3">
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">Evidence trail</div>
        <div className="mt-3 grid gap-2.5">
          {[
            ["03:14", "Clarified missing requirements"],
            ["06:42", "Compared architecture tradeoffs"],
            ["08:51", "Covered failure handling"],
          ].map(([time, detail]) => (
            <div key={time} className="grid grid-cols-[3.25rem_minmax(0,1fr)] items-start gap-3">
              <span className="rounded bg-cyan-300/10 px-2 py-1 text-xs font-semibold text-cyan-100">{time}</span>
              <span className="text-sm leading-6 text-slate-200">{detail}</span>
            </div>
          ))}
        </div>

        <p className="mt-4 rounded-md bg-white/[0.06] px-4 py-2.5 text-sm leading-6 text-cyan-100">
          The panel gets the decision and the trail behind it without rewatching the full screen.
        </p>
      </div>
    </div>
  );
}
function FinalCta() {
  return (
    <section className="relative z-10 px-5 py-16 sm:px-6 md:py-20">
      <div data-reveal className="mx-auto grid max-w-7xl gap-8 rounded-lg border border-slate-200 bg-white p-6 shadow-[0_28px_90px_rgba(15,23,42,0.1)] md:grid-cols-[1fr_auto] md:p-8">
        <div>
          <div className="flex items-center gap-2">
            <Image src="/puddle-symbol-black-nobg.png" alt="" width={34} height={34} className="h-8 w-8" />
            <span className="text-lg font-semibold text-slate-950">Puddle</span>
          </div>
          <h2 className="mt-6 max-w-3xl text-3xl font-semibold leading-tight text-slate-950 md:text-4xl">
            Start with one role and a small pilot cohort.
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
            We will map your rubric, source and screen candidates, and hand your team the evidence needed to meet the
            best people in person.
          </p>
        </div>
        <div className="flex flex-col justify-end gap-3 sm:flex-row md:flex-col">
          <a
            href="mailto:hello@usepuddle.com"
            className="inline-flex min-h-12 items-center justify-center rounded-md bg-slate-950 px-6 text-sm font-semibold !text-white transition hover:bg-slate-800"
          >
            Book a pilot
          </a>
          <Link
            href="/dashboard"
            className="inline-flex min-h-12 items-center justify-center rounded-md border border-slate-300 bg-white px-6 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
          >
            Staff sign in
          </Link>
        </div>
      </div>
      <PublicFooter
        className="mt-8"
        padded={false}
        extraLinks={[
          { label: "Process", href: "#system" },
          { label: "Sample report", href: "#review-packet" },
        ]}
      />
    </section>
  );
}
