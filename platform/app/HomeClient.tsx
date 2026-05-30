"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";

const navLinks = [
  { label: "Rubric", href: "#rubric" },
  { label: "Video screen", href: "#video-screen" },
  { label: "AI build test", href: "#ai-build-test" },
];

const customerLogos = [
  { label: "Y Combinator", src: "/logos/customers/y-combinator.svg", width: 280, height: 64, className: "h-10 sm:h-11" },
  { label: "Pioneer Fund", src: "/logos/customers/pioneer-fund.png", width: 520, height: 122, className: "h-9 sm:h-10" },
  { label: "Pear VC", src: "/logos/customers/pear-vc.svg", width: 72, height: 56, className: "h-14 sm:h-16" },
  { label: "Nestora", src: "/logos/customers/nestora.svg", width: 210, height: 64, className: "h-10 sm:h-11" },
  { label: "Telora", src: "/logos/customers/telora.svg", width: 220, height: 64, className: "h-9 sm:h-10" },
];

const heroStats = [
  ["10x", "faster AI engineer hiring"],
  ["10 min", "video screens per candidate"],
  ["200 -> 20", "hours of hiring work"],
];

const heroHighlights = [
  {
    title: "Role-specific rubric",
    detail: "Define your bar for collaboration, determination, technical skill, and any team-specific criteria.",
  },
  {
    title: "AI recruiter",
    detail: "Source and screen candidates using rubric data, GitHub work, hackathon performance, and peer signals.",
  },
  {
    title: "Fast video interviews",
    detail: "Run direct 10-minute interviews that make it harder to hide behind polished resumes or rehearsed answers.",
  },
  {
    title: "Coding-agent baseline",
    detail: "Observe how candidates build with AI agents and compare their work against your own engineers.",
  },
];

const candidateSteps = [
  {
    label: "Rubric",
    title: "Set the standard for the role",
    detail: "Puddle works with your team to define what above-bar, at-bar, and below-bar look like for every hiring dimension.",
    status: "Hiring bar set",
  },
  {
    label: "Source",
    title: "Find candidates beyond the resume",
    detail: "The AI recruiter screens candidates against your rubric using GitHub repos, hackathon results, and peer recommendations.",
    status: "Pipeline ranked",
  },
  {
    label: "Interview",
    title: "Run 10-minute video screens",
    detail: "A trained interviewer agent asks direct, granular questions at a faster pace to surface honest, less scripted signal.",
    status: "Screens running",
  },
  {
    label: "Build",
    title: "Watch candidates work with AI",
    detail: "Puddle observes candidates building alongside coding agents and compares the work to your own engineering baseline.",
    status: "Build signal captured",
  },
];

const reviewerSignals = [
  { label: "Technical skill", value: 92 },
  { label: "Collaboration", value: 88 },
  { label: "Determination", value: 84 },
  { label: "AI-agent fluency", value: 90 },
];

const controlItems = [
  {
    title: "The rubric replaces resume-first screening",
    detail: "Candidates are evaluated against the standards your engineering team actually cares about, not pedigree shortcuts.",
  },
  {
    title: "Granular questions reduce scripted answers",
    detail: "Short, direct video interviews keep candidates moving and reveal how they think when the questions get specific.",
  },
  {
    title: "Evidence stays reviewable",
    detail: "Every recording, transcript, summary, source signal, and rubric decision is available for your team to inspect.",
  },
  {
    title: "AI-era engineering is tested directly",
    detail: "Puddle observes candidates building with coding agents instead of pretending modern engineers work without AI tools.",
  },
];

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
      <FloatingNav />
      <HeroSection />
      <ProofStrip />
      <CandidateFlowSection />
      <EvidenceSection />
      <ControlsSection />
      <FinalCta />
    </main>
  );
}

function FloatingNav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.documentElement.style.overflow = open ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [open]);

  return (
    <nav aria-label="Global" className="fixed inset-x-0 top-4 z-50 px-4">
      <div className="mx-auto max-w-7xl overflow-hidden rounded-lg border border-slate-200/80 bg-white/[0.92] shadow-[0_16px_48px_rgba(15,23,42,0.12)] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-4 px-3 py-2.5 sm:px-4">
          <a href="#top" className="flex min-w-0 items-center gap-2" aria-label="Puddle home">
            <Image src="/puddle-symbol-black-nobg.png" alt="" width={38} height={38} className="h-9 w-9" priority />
            <span className="text-lg font-semibold text-slate-950">Puddle</span>
          </a>

          <div className="hidden items-center gap-1 md:flex">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div className="hidden items-center gap-2 sm:flex">
            <Link
              href="/dashboard"
              className="rounded-md px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
            >
              Sign in
            </Link>
            <a
              href="mailto:hello@usepuddle.com"
              className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold !text-white transition hover:bg-slate-800"
            >
              Book a pilot
            </a>
          </div>

          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-950 md:hidden"
          >
            <span className="grid gap-1">
              <span className={`block h-0.5 w-4 bg-current transition ${open ? "translate-y-1.5 rotate-45" : ""}`} />
              <span className={`block h-0.5 w-4 bg-current transition ${open ? "opacity-0" : ""}`} />
              <span className={`block h-0.5 w-4 bg-current transition ${open ? "-translate-y-1.5 -rotate-45" : ""}`} />
            </span>
          </button>
        </div>

        {open ? (
          <div className="border-t border-slate-200 px-3 pb-3 pt-2 md:hidden">
            <div className="grid gap-1">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  {link.label}
                </a>
              ))}
              <a
                href="mailto:hello@usepuddle.com"
                onClick={() => setOpen(false)}
                className="mt-2 rounded-md bg-slate-950 px-3 py-3 text-center text-sm font-semibold !text-white"
              >
                Book a pilot
              </a>
              <Link
                href="/dashboard"
                onClick={() => setOpen(false)}
                className="rounded-md border border-slate-200 px-3 py-3 text-center text-sm font-semibold text-slate-700"
              >
                Sign in
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </nav>
  );
}

function HeroSection() {
  return (
    <section id="top" className="relative z-10 px-5 pb-12 pt-32 sm:px-6 lg:pb-14 lg:pt-36">
      <div className="mx-auto max-w-7xl">
        <div data-reveal className="mx-auto max-w-5xl text-center">
          <div className="inline-flex items-center gap-2 rounded-md border border-cyan-200 bg-cyan-50/90 px-3 py-1.5 text-sm font-semibold text-cyan-900 shadow-[0_12px_34px_rgba(8,145,178,0.1)] backdrop-blur">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Live AI voice interview platform
          </div>

          <h1 className="mx-auto mt-6 max-w-5xl text-4xl font-semibold leading-[1.02] tracking-normal text-slate-950 sm:text-5xl lg:text-7xl">
            Run live AI voice interviews that produce review-ready evidence.
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-slate-600">
            Invite candidates into a guided video room, let a controlled voice interviewer run the screen, and give
            reviewers transcripts, timing, probes, and scoring context in one packet.
          </p>

          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <a
              href="mailto:hello@usepuddle.com"
              className="inline-flex min-h-12 items-center justify-center rounded-md bg-slate-950 px-6 text-base font-semibold !text-white shadow-[0_18px_46px_rgba(15,23,42,0.2)] transition hover:-translate-y-0.5 hover:bg-slate-800"
            >
              Book a pilot
            </a>
            <a
              href="#candidate-flow"
              className="inline-flex min-h-12 items-center justify-center rounded-md border border-slate-300 bg-white px-6 text-base font-semibold !text-slate-900 transition hover:-translate-y-0.5 hover:border-slate-400"
            >
              See the candidate flow
            </a>
          </div>
        </div>

        <div
          data-reveal
          className="mx-auto mt-10 max-w-6xl overflow-hidden rounded-lg border border-slate-200 bg-white/90 shadow-[0_34px_110px_rgba(15,23,42,0.13)] backdrop-blur-xl"
        >
          <div className="grid divide-y divide-slate-200 border-b border-slate-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {heroStats.map(([value, label]) => (
              <div key={label} className="px-5 py-4 text-center">
                <div className="text-2xl font-semibold text-slate-950">{value}</div>
                <div className="mt-1 text-sm font-medium text-slate-500">{label}</div>
              </div>
            ))}
          </div>

          <div className="grid md:grid-cols-[0.86fr_1.14fr]">
            <div className="border-b border-slate-200 bg-slate-950 p-5 text-white md:border-b-0 md:border-r md:p-6">
              <div className="flex items-center justify-between gap-3">
                <span className="rounded-md bg-emerald-400/12 px-2.5 py-1 text-xs font-semibold text-emerald-100">
                  Interview active
                </span>
                <span className="text-xs text-white/55">12:04 elapsed</span>
              </div>

              <div className="mt-8">
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">Question 2</div>
                <h2 className="mt-3 text-2xl font-semibold leading-tight">
                  Recover a project when the first plan stopped working.
                </h2>
                <p className="mt-4 leading-7 text-slate-300">
                  Puddle captures the answer, timing, room state, and probe trail while the interview is still live.
                </p>

                <div className="mt-6 rounded-lg border border-white/10 bg-white/[0.05] p-4">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold text-white">Recommendation</span>
                    <span className="rounded-md bg-emerald-300 px-2.5 py-1 text-xs font-semibold text-emerald-950">
                      Advance
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-300">
                    Strong example, complete answer, handled one clarification probe.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-px bg-slate-200 sm:grid-cols-2">
              {heroHighlights.map((item) => (
                <div key={item.title} className="bg-white p-5">
                  <div className="mb-4 flex h-8 w-8 items-center justify-center rounded-md border border-cyan-200 bg-cyan-50 text-cyan-800">
                    <span className="h-3.5 w-3.5 rounded-[3px] border border-current bg-white" />
                  </div>
                  <h3 className="font-semibold text-slate-950">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div data-reveal className="mx-auto mt-6 grid max-w-6xl gap-3 text-sm sm:grid-cols-3">
          {[
            ["Answer evidence", "88%"],
            ["Probe recovery", "76%"],
            ["Session coverage", "94%"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-white/80 p-4 shadow-[0_14px_38px_rgba(15,23,42,0.05)] backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-700">{label}</span>
                <span className="font-semibold text-slate-950">{value}</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-cyan-500" style={{ width: value }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProofStrip() {
  return (
    <section className="relative z-10 border-y border-slate-200 bg-white/80 px-5 py-8 shadow-[0_22px_70px_rgba(15,23,42,0.06)] sm:px-6">
      <div data-reveal className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <p className="text-base font-semibold text-slate-700 sm:text-lg">
            Trusted by the next generation of companies.
          </p>

          <div className="inline-flex w-fit items-center gap-3 rounded-md bg-slate-950 px-3.5 py-2 text-xs font-semibold text-slate-300">
            <span>Backed by</span>
            <Image src="/hero/aforelogo.webp" alt="Afore Capital" width={122} height={49} className="h-5 w-auto" />
          </div>
        </div>

        <div className="mt-7 grid grid-cols-2 items-center gap-x-8 gap-y-7 sm:grid-cols-3 lg:grid-cols-5">
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
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CandidateFlowSection() {
  const [active, setActive] = useState(0);
  const step = candidateSteps[active];

  return (
    <section id="candidate-flow" className="relative z-10 border-y border-slate-200 bg-white px-5 py-20 sm:px-6 md:py-24">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.86fr_1.14fr]">
        <div data-reveal>
          <span className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-700">Candidate flow</span>
          <h2 className="mt-4 max-w-xl text-3xl font-semibold leading-tight text-slate-950 md:text-5xl">
            The candidate experience is a controlled room, not a chat window.
          </h2>
          <p className="mt-5 max-w-xl text-lg leading-8 text-slate-600">
            Puddle moves each candidate through the same observable states before the AI interviewer starts asking
            questions.
          </p>

          <div className="mt-8 grid gap-3">
            {candidateSteps.map((candidateStep, index) => (
              <button
                key={candidateStep.label}
                type="button"
                onClick={() => setActive(index)}
                className={`rounded-lg border p-4 text-left transition ${
                  active === index
                    ? "border-cyan-300 bg-cyan-50 shadow-[0_14px_34px_rgba(14,116,144,0.1)]"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm font-semibold text-slate-950">{candidateStep.label}</span>
                  <span className={active === index ? "text-sm font-semibold text-cyan-800" : "text-sm text-slate-400"}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">{candidateStep.title}</p>
              </button>
            ))}
          </div>
        </div>

        <div data-reveal className="rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-[0_24px_80px_rgba(15,23,42,0.1)] sm:p-5">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="text-sm font-semibold text-slate-950">Puddle interview room</div>
              <div className="mt-1 text-sm text-slate-500">Candidate waiting room</div>
            </div>

            <div className="grid gap-5 p-5 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="relative min-h-[390px] overflow-hidden rounded-lg bg-slate-950 text-white">
                <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-black/30 px-4 py-3 backdrop-blur">
                  <span className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-semibold text-white/85">
                    {step.label}
                  </span>
                  <span className="rounded-md bg-cyan-300 px-2.5 py-1 text-xs font-semibold text-slate-950">
                    {step.status}
                  </span>
                </div>

                <div className="grid min-h-[390px] place-items-center px-5 pt-12 text-center">
                  <div className="max-w-md">
                    <div className="mx-auto grid h-20 w-20 place-items-center rounded-lg bg-white/10 text-3xl font-semibold">
                      P
                    </div>
                    <h3 className="mt-5 text-3xl font-semibold leading-tight">{step.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-300">{step.detail}</p>
                  </div>
                </div>

                <div className="absolute inset-x-4 bottom-4 grid gap-2 sm:grid-cols-3">
                  {["Mic clear", "Camera on", "Room ready"].map((item) => (
                    <div key={item} className="rounded-md border border-white/10 bg-black/35 px-3 py-2 text-xs font-semibold text-white/75">
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">State</div>
                  <div className="mt-3 text-2xl font-semibold text-slate-950">{step.status}</div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{step.detail}</p>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="text-sm font-semibold text-slate-950">Session timeline</div>
                  <div className="mt-4 grid gap-3">
                    {candidateSteps.map((candidateStep, index) => (
                      <div key={candidateStep.label} className="flex items-start gap-3">
                        <span
                          className={`mt-1 h-3 w-3 rounded-full ${
                            index <= active ? "bg-cyan-500" : "bg-slate-200"
                          }`}
                        />
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{candidateStep.label}</div>
                          <div className="text-xs leading-5 text-slate-500">{candidateStep.status}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function EvidenceSection() {
  return (
    <section id="evidence" className="relative z-10 px-5 py-20 sm:px-6 md:py-24">
      <div className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[1.08fr_0.92fr]">
        <div data-reveal className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_28px_90px_rgba(15,23,42,0.12)] sm:p-6">
          <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Assessment packet</div>
              <h3 className="mt-2 text-2xl font-semibold text-slate-950">Reviewer handoff</h3>
            </div>
            <div className="rounded-lg bg-emerald-50 px-3 py-2 text-right">
              <div className="text-xs text-emerald-700">Status</div>
              <div className="text-sm font-semibold text-emerald-950">complete</div>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Recommendation</div>
              <div className="mt-2 text-4xl font-semibold text-slate-950">Advance</div>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Clear answers, strong recovery after follow-up questions, and complete session coverage.
              </p>
            </div>

            <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              {reviewerSignals.map((row) => (
                <div key={row.label}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium text-slate-700">{row.label}</span>
                    <span className="font-semibold text-slate-950">{row.value}%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-cyan-500" style={{ width: `${row.value}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Transcript excerpt</div>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Candidate gave a specific ownership example, named the recovery action, and explained the impact.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Probe history</div>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                One clarification probe was used after the first answer missed the measurable outcome.
              </p>
            </div>
          </div>
        </div>

        <div data-reveal>
          <span className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-700">Evidence</span>
          <h2 className="mt-4 max-w-xl text-3xl font-semibold leading-tight text-slate-950 md:text-5xl">
            Hiring teams get the answer and the trail behind it.
          </h2>
          <p className="mt-5 max-w-xl text-lg leading-8 text-slate-600">
            Puddle is designed for teams that need faster first-round screens without losing the ability to inspect how
            a recommendation was formed.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {["Final answer turns", "Question-level scoring", "Timing events", "Reviewer notes"].map((item) => (
              <div key={item} className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800">
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ControlsSection() {
  return (
    <section id="controls" className="relative z-10 border-y border-slate-200 bg-slate-950 px-5 py-20 text-white sm:px-6 md:py-24">
      <div className="mx-auto max-w-7xl">
        <div data-reveal className="grid gap-6 lg:grid-cols-[0.72fr_1.28fr]">
          <div>
            <span className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-200">Controls</span>
            <h2 className="mt-4 text-3xl font-semibold leading-tight md:text-5xl">
              Built for structured screens, not black-box interviews.
            </h2>
          </div>
          <p className="max-w-3xl text-lg leading-8 text-slate-300">
            Candidates know what is happening, the interviewer stays inside policy, and reviewers can audit the
            resulting packet.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {controlItems.map((item, index) => (
            <article key={item.title} data-reveal className="rounded-lg border border-white/10 bg-white/[0.05] p-5" style={{ transitionDelay: `${index * 80}ms` }}>
              <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-300 text-sm font-semibold text-slate-950">
                {String(index + 1).padStart(2, "0")}
              </div>
              <h3 className="text-xl font-semibold text-white">{item.title}</h3>
              <p className="mt-3 leading-7 text-slate-300">{item.detail}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
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
            Start with one pilot cohort and inspect every interview packet.
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
            We will help configure the room flow, interviewer script, and review packet around your first hiring screen.
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
      <footer className="mx-auto mt-8 flex max-w-7xl flex-col gap-3 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <span>{new Date().getFullYear()} Puddle. AI voice interview infrastructure.</span>
        <div className="flex gap-4">
          <a href="mailto:hello@usepuddle.com" className="hover:text-slate-950">
            Contact
          </a>
          <a href="#candidate-flow" className="hover:text-slate-950">
            Candidate flow
          </a>
          <a href="#evidence" className="hover:text-slate-950">
            Evidence
          </a>
        </div>
      </footer>
    </section>
  );
}
