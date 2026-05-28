"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";

const navLinks = [
  { label: "Platform", href: "#platform" },
  { label: "Workflow", href: "#workflow" },
  { label: "Signal", href: "#signal" },
];

const capabilityCards = [
  {
    eyebrow: "Live room",
    title: "Candidate-ready video and voice flow",
    description:
      "Preflight, consent, room join, and calm waiting states for every interview session.",
  },
  {
    eyebrow: "AI interviewer",
    title: "Scripted voice loop with controlled probes",
    description:
      "The agent asks planned questions, listens for final turns, and probes only when the rubric calls for it.",
  },
  {
    eyebrow: "Review packet",
    title: "Transcript, scores, and audit trail",
    description:
      "Each completed session becomes a structured assessment that reviewers can trust and inspect.",
  },
];

const workflowSteps = [
  {
    title: "Create the session",
    detail: "Schedule or self-serve a candidate room with the rubric, timing rules, and interviewer policy attached.",
    metric: "01",
  },
  {
    title: "Join with mic and camera",
    detail: "The candidate completes consent and device checks before Puddle connects them to the live room.",
    metric: "02",
  },
  {
    title: "Run the voice interview",
    detail: "The AI interviewer speaks the questions, captures final answers, and adapts with bounded probes.",
    metric: "03",
  },
  {
    title: "Review the assessment",
    detail: "Scores, transcript excerpts, timing events, and status updates land together for the hiring team.",
    metric: "04",
  },
];

const signalRows = [
  { label: "Answer evidence", value: 88, color: "bg-cyan-400" },
  { label: "Communication clarity", value: 91, color: "bg-sky-400" },
  { label: "Probe recovery", value: 76, color: "bg-emerald-400" },
  { label: "Session completeness", value: 94, color: "bg-violet-400" },
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
      { threshold: 0.16, rootMargin: "0px 0px -10% 0px" },
    );

    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);
}

function useFloatingNav() {
  const [state, setState] = useState({ elevated: false, hidden: false, progress: 0 });
  const lastScrollY = useRef(0);

  useEffect(() => {
    let frame = 0;

    const update = () => {
      const scrollY = window.scrollY;
      const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const moved = Math.abs(scrollY - lastScrollY.current) > 5;
      const goingDown = scrollY > lastScrollY.current;

      setState({
        elevated: scrollY > 10,
        hidden: moved && goingDown && scrollY > 92,
        progress: Math.min(1, scrollY / maxScroll),
      });
      lastScrollY.current = scrollY;
      frame = 0;
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return state;
}

export default function HomeClient() {
  useLandingReveal();

  return (
    <main className="puddle-page">
      <CosmicBackdrop />
      <FloatingNav />
      <HeroSection />
      <PlatformSection />
      <WorkflowSection />
      <SignalSection />
      <FooterSection />
    </main>
  );
}

function CosmicBackdrop() {
  const pixels = useMemo(
    () =>
      Array.from({ length: 95 }, (_, index) => ({
        id: index,
        left: (index * 37) % 100,
        top: (index * 61) % 84,
        delay: `${((index * 13) % 40) / 10}s`,
        size: 1 + (index % 3),
      })),
    [],
  );

  return (
    <div aria-hidden className="puddle-backdrop">
      <div className="puddle-backdrop__sky" />
      <div className="puddle-backdrop__grid" />
      <div className="puddle-backdrop__landscape" />
      {pixels.map((pixel) => (
        <span
          key={pixel.id}
          className="puddle-pixel"
          style={{
            left: `${pixel.left}%`,
            top: `${pixel.top}%`,
            width: pixel.size,
            height: pixel.size,
            animationDelay: pixel.delay,
          }}
        />
      ))}
    </div>
  );
}

function FloatingNav() {
  const { elevated, hidden, progress } = useFloatingNav();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.documentElement.style.overflow = open ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [open]);

  return (
    <nav
      aria-label="Global"
      className={`fixed left-0 right-0 top-4 z-50 flex justify-center px-3 transition-transform duration-300 ${
        hidden && !open ? "-translate-y-24" : "translate-y-0"
      }`}
    >
      <div
        className={`w-full max-w-6xl overflow-hidden rounded-full border border-white/[0.12] bg-black/90 text-white backdrop-blur-xl transition-shadow ${
          elevated ? "shadow-[0_18px_44px_rgba(0,0,0,0.34)]" : "shadow-[0_8px_26px_rgba(0,0,0,0.22)]"
        }`}
      >
        <div className="flex items-center justify-between gap-4 px-3 py-2.5 sm:px-5">
          <a href="#top" className="flex min-w-0 items-center gap-2" aria-label="Puddle home">
            <Image src="/puddle-symbol-white-nobg.svg" alt="" width={40} height={40} className="h-10 w-10" />
            <span className="bg-gradient-to-r from-cyan-300 to-violet-300 bg-clip-text text-lg font-semibold text-transparent">
              Puddle
            </span>
          </a>

          <div className="hidden items-center gap-2 md:flex">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-full px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/10 hover:text-white"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/dashboard"
              className="hidden rounded-full px-3 py-2 text-sm font-medium text-white/[0.78] transition hover:bg-white/10 hover:text-white sm:inline-flex"
            >
              Sign in
            </Link>
            <a
              href="mailto:hello@usepuddle.com"
              className="hidden rounded-full border border-white/[0.14] bg-white px-4 py-2 text-sm font-medium !text-slate-950 transition hover:bg-cyan-50 sm:inline-flex"
            >
              Book a pilot
            </a>
            <button
              type="button"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.12] bg-white/10 md:hidden"
            >
              <span className="flex flex-col gap-1.5">
                <span className={`block h-0.5 w-4 bg-white transition ${open ? "translate-y-2 rotate-45" : ""}`} />
                <span className={`block h-0.5 w-4 bg-white transition ${open ? "opacity-0" : ""}`} />
                <span className={`block h-0.5 w-4 bg-white transition ${open ? "-translate-y-2 -rotate-45" : ""}`} />
              </span>
            </button>
          </div>
        </div>

        <div className="hidden px-7 pb-2 md:block">
          <div className="h-0.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full origin-left rounded-full bg-gradient-to-r from-cyan-300 via-sky-400 to-violet-300 transition-transform duration-150"
              style={{ transform: `scaleX(${progress})` }}
            />
          </div>
        </div>

        {open ? (
          <div className="border-t border-white/10 px-3 pb-3 pt-2 md:hidden">
            <div className="grid gap-1">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-3 text-sm text-white/90 hover:bg-white/10"
                >
                  {link.label}
                </a>
              ))}
              <a
                href="mailto:hello@usepuddle.com"
                onClick={() => setOpen(false)}
                className="mt-2 rounded-lg bg-white px-3 py-3 text-center text-sm font-medium !text-slate-950"
              >
                Book a pilot
              </a>
              <Link
                href="/dashboard"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-white/10 px-3 py-3 text-center text-sm font-medium text-white/90 hover:bg-white/10"
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
    <section id="top" className="relative z-10 flex min-h-[88svh] items-center overflow-hidden px-6 pb-12 pt-32">
      <div className="mx-auto grid w-full max-w-7xl items-center gap-10 lg:grid-cols-[0.95fr_1.05fr]">
        <div data-reveal className="max-w-2xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/[0.82] px-3 py-1.5 text-sm font-medium text-slate-700 shadow-[0_10px_30px_rgba(15,23,42,0.08)] backdrop-blur">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.8)]" />
            Live AI voice interviews
          </div>

          <h1 className="max-w-xl text-5xl font-semibold leading-[1.02] text-slate-950 sm:text-6xl lg:text-7xl">
            Puddle
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600 sm:text-xl">
            The interview platform for structured AI voice screens. Candidates join a live room, answer out loud, and
            hiring teams get a review-ready assessment.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a
              href="mailto:hello@usepuddle.com"
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-6 text-base font-semibold !text-white shadow-[0_18px_46px_rgba(15,23,42,0.22)] transition hover:-translate-y-0.5 hover:bg-slate-800"
            >
              Book a pilot
            </a>
            <a
              href="#workflow"
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-slate-300 bg-white/[0.76] px-6 text-base font-semibold !text-slate-900 shadow-[0_14px_34px_rgba(15,23,42,0.08)] backdrop-blur transition hover:-translate-y-0.5 hover:bg-white"
            >
              See workflow
            </a>
            <Link
              href="/dashboard"
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-slate-300 bg-white/[0.54] px-6 text-base font-semibold !text-slate-900 shadow-[0_14px_34px_rgba(15,23,42,0.08)] backdrop-blur transition hover:-translate-y-0.5 hover:bg-white"
            >
              Open dashboard
            </Link>
          </div>

          <div className="mt-9 grid max-w-xl grid-cols-3 gap-3 text-sm">
            {[
              ["Voice", "scripted interviewer"],
              ["Video", "candidate room"],
              ["Review", "assessment packet"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-white/70 bg-white/[0.64] p-3 shadow-[0_12px_32px_rgba(15,23,42,0.06)] backdrop-blur">
                <div className="font-semibold text-slate-950">{label}</div>
                <div className="mt-1 text-slate-600">{value}</div>
              </div>
            ))}
          </div>
        </div>

        <div data-reveal className="relative lg:justify-self-end">
          <LiveRoomVisual />
        </div>
      </div>
    </section>
  );
}

function LiveRoomVisual() {
  return (
    <div className="relative mx-auto w-full max-w-[650px]">
      <div className="relative overflow-hidden rounded-lg border border-slate-300/80 bg-slate-950 text-white shadow-[0_32px_90px_rgba(15,23,42,0.28)]">
        <div className="flex items-center justify-between border-b border-white/10 bg-black/30 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5" aria-hidden>
              <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            </div>
            <div>
              <div className="text-sm font-semibold">puddle-room.live</div>
              <div className="text-xs text-white/50">Candidate session active</div>
            </div>
          </div>
          <span className="rounded-full border border-emerald-300/28 bg-emerald-300/12 px-3 py-1 text-xs font-medium text-emerald-100">
            Recording off
          </span>
        </div>

        <div className="grid gap-4 p-4 md:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-4">
            <div className="relative aspect-video overflow-hidden rounded-lg border border-white/10 bg-gradient-to-br from-slate-800 via-slate-950 to-cyan-950">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_28%,rgba(125,211,252,0.22),transparent_38%)]" />
              <div className="absolute left-5 top-5 inline-flex items-center gap-2 rounded-full bg-black/50 px-3 py-1 text-xs text-white/75 backdrop-blur">
                <span className="h-2 w-2 rounded-full bg-cyan-300" />
                Agent speaking
              </div>
              <div className="absolute bottom-5 left-5 right-5 rounded-lg border border-white/[0.12] bg-black/50 p-4 backdrop-blur">
                <div className="text-xs uppercase tracking-[0.25em] text-cyan-200/80">Question 2</div>
                <p className="mt-2 text-sm leading-6 text-white/90">
                  Tell me about a time you had to recover a project when the first plan stopped working.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                ["Mic", "clear"],
                ["Camera", "on"],
                ["Room", "joined"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-white/10 bg-white/[0.06] p-3">
                  <div className="text-xs text-white/50">{label}</div>
                  <div className="mt-1 text-sm font-semibold text-white">{value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Live transcript</div>
                <div className="text-xs text-white/50">Final turns only</div>
              </div>
              <span className="rounded-full bg-cyan-300/14 px-2.5 py-1 text-xs text-cyan-100">VAD ready</span>
            </div>

            <div className="mt-4 space-y-3">
              {[
                ["Puddle", "What outcome were you accountable for?"],
                ["Candidate", "I owned the launch plan and worked with support to recover the timeline."],
                ["Puddle", "What changed after the first signal came in?"],
              ].map(([speaker, line]) => (
                <div key={`${speaker}-${line}`} className="rounded-lg border border-white/10 bg-black/25 p-3">
                  <div className="text-xs font-medium text-cyan-100">{speaker}</div>
                  <div className="mt-1 text-sm leading-6 text-white/75">{line}</div>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-lg border border-white/10 bg-black/30 p-3">
              <div className="flex items-center justify-between text-xs text-white/60">
                <span>Probe confidence</span>
                <span>82%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-[82%] rounded-full bg-gradient-to-r from-cyan-300 to-emerald-300" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlatformSection() {
  return (
    <section id="platform" className="relative z-10 px-6 py-20 md:py-24">
      <div className="mx-auto max-w-7xl">
        <div data-reveal className="max-w-3xl">
          <span className="text-sm font-semibold uppercase tracking-[0.28em] text-sky-700">Platform</span>
          <h2 className="mt-4 text-3xl font-semibold leading-tight text-slate-950 md:text-5xl">
            A controlled interview system from room join to reviewer handoff.
          </h2>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {capabilityCards.map((card, index) => (
            <article
              key={card.title}
              data-reveal
              className="rounded-lg border border-white/[0.72] bg-white/70 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.08)] backdrop-blur"
              style={{ transitionDelay: `${index * 90}ms` }}
            >
              <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg bg-slate-950 text-sm font-semibold text-cyan-200">
                {String(index + 1).padStart(2, "0")}
              </div>
              <div className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">{card.eyebrow}</div>
              <h3 className="mt-3 text-xl font-semibold text-slate-950">{card.title}</h3>
              <p className="mt-3 leading-7 text-slate-600">{card.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function WorkflowSection() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        setActive((value) => (value + 1) % workflowSteps.length);
      }
    }, 3600);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <section id="workflow" className="relative z-10 px-6 py-20 md:py-28">
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <div data-reveal className="lg:sticky lg:top-32 lg:self-start">
          <span className="text-sm font-semibold uppercase tracking-[0.28em] text-sky-700">Workflow</span>
          <h2 className="mt-4 text-3xl font-semibold leading-tight text-slate-950 md:text-5xl">
            The session moves through four explicit states.
          </h2>
          <p className="mt-5 max-w-lg text-lg leading-8 text-slate-600">
            Puddle keeps the live experience bounded and observable, so the assessment has the same shape every time.
          </p>
        </div>

        <div data-reveal className="rounded-lg border border-slate-200/80 bg-slate-950 p-4 text-white shadow-[0_30px_90px_rgba(15,23,42,0.22)] md:p-5">
          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-3">
              {workflowSteps.map((step, index) => (
                <button
                  key={step.title}
                  type="button"
                  onClick={() => setActive(index)}
                  className={`w-full rounded-lg border p-4 text-left transition ${
                    active === index
                      ? "border-cyan-300/55 bg-cyan-300/12 shadow-[0_0_0_1px_rgba(103,232,249,0.16)]"
                      : "border-white/10 bg-white/[0.04] hover:border-white/20"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-white">{step.title}</span>
                    <span className={active === index ? "text-cyan-200" : "text-white/40"}>{step.metric}</span>
                  </div>
                  <p className={`mt-2 text-sm leading-6 ${active === index ? "text-white/75" : "text-white/50"}`}>
                    {step.detail}
                  </p>
                </button>
              ))}
            </div>

            <div className="rounded-lg border border-white/10 bg-black/30 p-5">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div>
                  <div className="text-sm font-semibold">Session controller</div>
                  <div className="text-xs text-white/50">State {workflowSteps[active].metric}</div>
                </div>
                <span className="rounded-full border border-white/10 bg-white/[0.07] px-3 py-1 text-xs text-white/60">
                  deterministic
                </span>
              </div>

              <div className="mt-5 space-y-4">
                <div className="rounded-lg border border-white/10 bg-white/[0.05] p-4">
                  <div className="text-xs uppercase tracking-[0.25em] text-cyan-200/80">Active state</div>
                  <div className="mt-2 text-2xl font-semibold">{workflowSteps[active].title}</div>
                  <p className="mt-3 text-sm leading-6 text-white/60">{workflowSteps[active].detail}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {[
                    ["Room status", active > 0 ? "connected" : "provisioning"],
                    ["Voice adapter", active > 1 ? "listening" : "standing by"],
                    ["Assessment", active > 2 ? "ready" : "pending"],
                    ["Audit log", "capturing"],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-white/10 bg-black/25 p-3">
                      <div className="text-xs text-white/40">{label}</div>
                      <div className="mt-1 text-sm font-semibold text-white">{value}</div>
                    </div>
                  ))}
                </div>

                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-sky-400 to-violet-300 transition-all duration-500"
                    style={{ width: `${((active + 1) / workflowSteps.length) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SignalSection() {
  return (
    <section id="signal" className="relative z-10 px-6 py-20 md:py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-8 lg:grid-cols-[1.05fr_0.95fr]">
        <div data-reveal className="rounded-lg border border-slate-200 bg-white/[0.76] p-5 shadow-[0_30px_90px_rgba(15,23,42,0.12)] backdrop-blur md:p-6">
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-5">
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">Assessment</div>
              <h3 className="mt-2 text-2xl font-semibold text-slate-950">Review-ready packet</h3>
            </div>
            <div className="rounded-lg bg-emerald-50 px-3 py-2 text-right">
              <div className="text-xs text-emerald-700">Status</div>
              <div className="text-sm font-semibold text-emerald-900">complete</div>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-[0.85fr_1.15fr]">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Recommendation</div>
              <div className="mt-2 text-4xl font-semibold text-slate-950">Advance</div>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Clear answers, strong recovery after follow-up questions, and complete session coverage.
              </p>
            </div>
            <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              {signalRows.map((row) => (
                <div key={row.label}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700">{row.label}</span>
                    <span className="font-semibold text-slate-950">{row.value}%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                    <div className={`h-full rounded-full ${row.color}`} style={{ width: `${row.value}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Reviewer notes</div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Candidate gave specific examples, handled one clarification probe well, and completed all required
              questions inside the session cap.
            </p>
          </div>
        </div>

        <div data-reveal>
          <span className="text-sm font-semibold uppercase tracking-[0.28em] text-sky-700">Signal</span>
          <h2 className="mt-4 text-3xl font-semibold leading-tight text-slate-950 md:text-5xl">
            Built for interview evidence, not vibes.
          </h2>
          <p className="mt-5 max-w-xl text-lg leading-8 text-slate-600">
            The platform keeps timing, transcript, scoring, and state changes together. Recruiters get the summary;
            evaluators can inspect the trail behind it.
          </p>
          <div className="mt-8 grid max-w-xl gap-3 sm:grid-cols-2">
            {["Final transcript turns", "Question-level scores", "Probe history", "Session status updates"].map((item) => (
              <div key={item} className="rounded-lg border border-white/70 bg-white/[0.64] px-4 py-3 font-medium text-slate-800 shadow-[0_12px_32px_rgba(15,23,42,0.06)] backdrop-blur">
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FooterSection() {
  return (
    <section className="relative z-10 px-6 pb-10 pt-10">
      <div data-reveal className="mx-auto max-w-7xl overflow-hidden rounded-lg border border-white/[0.12] bg-slate-950 text-white shadow-[0_32px_100px_rgba(15,23,42,0.24)]">
        <div className="grid gap-8 p-6 md:grid-cols-[1fr_auto] md:p-8">
          <div>
            <div className="flex items-center gap-2">
              <Image src="/puddle-symbol-white-nobg.svg" alt="" width={34} height={34} className="h-8 w-8" />
              <span className="text-lg font-semibold">Puddle</span>
            </div>
            <h2 className="mt-6 max-w-2xl text-3xl font-semibold leading-tight md:text-4xl">
              Start with a pilot cohort and see every interview as structured evidence.
            </h2>
          </div>
          <div className="flex flex-col justify-end gap-3 sm:flex-row md:flex-col">
            <a
              href="mailto:hello@usepuddle.com"
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-white px-6 text-sm font-semibold !text-slate-950 transition hover:bg-cyan-50"
            >
              Book a pilot
            </a>
            <a
              href="#top"
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/[0.14] bg-white/[0.07] px-6 text-sm font-semibold !text-white transition hover:bg-white/[0.12]"
            >
              Back to top
            </a>
            <Link
              href="/dashboard"
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/[0.14] bg-white/[0.07] px-6 text-sm font-semibold !text-white transition hover:bg-white/[0.12]"
            >
              Dashboard
            </Link>
          </div>
        </div>
        <footer className="flex flex-col gap-4 border-t border-white/10 px-6 py-5 text-sm text-white/60 md:flex-row md:items-center md:justify-between md:px-8">
          <span>{new Date().getFullYear()} Puddle. AI voice interview infrastructure.</span>
          <div className="flex gap-4">
            <a href="mailto:hello@usepuddle.com" className="hover:text-white">
              Contact
            </a>
            <a href="#platform" className="hover:text-white">
              Platform
            </a>
            <a href="#signal" className="hover:text-white">
              Signal
            </a>
          </div>
        </footer>
      </div>
    </section>
  );
}
