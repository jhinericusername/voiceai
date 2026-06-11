I’m working from the pasted feedback because the earlier uploaded file is no longer available on my side. Classic computers: storing everything except the one thing you need. But the pasted info is enough to make the call.

## My decision

**No, you do not need a completed SOC 2 report before launching live candidates next week.**

**Yes, you need to start behaving like a SOC 2 company immediately.**

The real launch blocker is not “do we have SOC 2?” The blocker is whether you can safely run live candidate interviews without creating obvious security, privacy, employment-law, and operational disaster modes. SOC 2 is a trust artifact. Candidate recordings leaking, unauthenticated session creation, unclear AI disclosure, or accidental automated hiring recommendations are the real boss fights.

AICPA frames SOC reports as assurance reports that help users assess risks when outsourcing services, which is exactly how future customers will treat you once they realize you are storing interview recordings, transcripts, and hiring-adjacent workflow data. ([AICPA & CIMA][1]) SOC 2 reports are tied to controls relevant to security, availability, processing integrity, confidentiality, and privacy. ([AICPA & CIMA][1])

So the answer is:

> **Launch next week only as a controlled, invite-only beta with SOC-ready controls, not as a public self-serve production platform.**

## What the pasted SOC 2 answer got right

The answer is directionally right.

**Correct:** SOC 2 is not a day-one legal requirement. It is mostly a customer trust and procurement requirement. If your first customers are friendly design partners or early-stage companies, you can likely run pilots with a security packet, DPA, privacy notice, and strong operational controls.

**Correct:** You should start SOC 2 readiness now. The cheapest time to implement access control, audit logs, secrets management, data retention, vendor tracking, incident response, and change management is before the platform becomes a haunted mansion of founder shortcuts.

**Correct:** Type I before Type II. Type I is useful once you have designed and implemented your controls. Type II requires operating evidence over time. You cannot speedrun months of operating evidence like a Rocket League kickoff exploit. You actually have to run the controls.

**Correct:** Security and Confidentiality are the right initial SOC 2 categories. Add Availability only once you make real uptime commitments. Add Processing Integrity once you have scoring or automated evaluations. Privacy is trickier: you need privacy controls now, but you may not need the Privacy criterion in your first SOC 2 scope.

**Correct:** SOC 2 does not solve AI hiring compliance. NYC’s AEDT law prohibits covered employers and employment agencies from using an automated employment decision tool unless it has had a bias audit within one year, audit information is public, and required notices are given. ([NYC.gov][2]) The EEOC and DOJ have warned that AI/software tools used for employment decisions can violate the ADA, including by screening out disabled applicants or causing prohibited disability-related inquiries. ([EEOC][3])

## What the pasted answer missed or underweighted

The answer is too soft for “live candidates next week.”

The biggest miss is that **a security packet is not enough if your actual platform has obvious unsafe paths**. If `POST /sessions` or integration session creation is publicly reachable without auth, you do not have a SOC 2 problem. You have a “random person on the internet can create candidate sessions and maybe trigger paid infrastructure” problem. Truly, humanity’s most persistent API design pattern: “what if we made the expensive thing public?”

The second miss is that **candidate consent and recording notice are launch gates**, not legal paperwork decorations. Recording laws vary by state; the Reporters Committee’s guide explicitly tracks state-by-state consent laws and warns that some violations can carry criminal penalties or civil lawsuits. ([Reporters Committee][4]) For your product, the practical answer is simple: use **explicit all-party consent by default**, always.

The third miss is that **you should not claim “SOC 2 in progress” unless you mean it**. If you have not selected an auditor, defined scope, started control evidence collection, or begun a readiness process, say:

> “SOC 2 readiness is underway.”

Do not say:

> “SOC 2 in progress.”

Procurement people can smell compliance cosplay through a PDF.

The fourth miss is **retention**. Employers have recordkeeping obligations. EEOC regulations require covered employers to keep personnel or employment records for one year, and longer when a charge is filed. ([EEOC][5]) You are the vendor, not necessarily the employer, but your retention/deletion terms must not accidentally fight your customer’s obligations.

The fifth miss is **California/privacy posture**. If you collect candidate data from California residents and meet CCPA thresholds, California’s CCPA/CPRA framework gives rights around knowing, deleting, correcting, and limiting use of sensitive personal information; California also notes that employment-related exemptions expired on December 31, 2022. ([California Attorney General][6]) You may not hit thresholds immediately, but build like this is coming because, well, it is.

## The actual go-live rule for next week

You can launch live candidates next week only if the launch looks like this:

```text
Invite-only
Low volume
Known customer/design partner
Human review only
No automated score
No rank
No pass/fail recommendation
Explicit AI disclosure
Explicit recording consent
Authenticated admin access
No public session creation
Private recordings
Clear retention/deletion policy
Support path for candidate issues
Manual monitoring during interviews
```

You should **not** launch if it looks like this:

```text
Public API can create sessions
Admin dashboard is weakly protected
Candidate recordings are accessible by guessable URLs
No /healthz
No recording finalization alerts
No consent record
No DPA/privacy notice
No access logs
No incident process
AI produces hiring recommendations
AI scores candidates
AI analyzes facial expressions, gaze, emotion, accent, or “confidence”
```

That second list is how startups accidentally invent plaintiff exhibits.

## My recommendation on SOC 2

### What to do now

Start SOC 2 readiness this week.

Do not pay for the audit yet unless an enterprise customer requires it. But begin collecting evidence and operating controls now.

Your message to customers should be:

> “We are SOC 2-ready by design and are beginning formal readiness. We can provide our security packet, architecture overview, data flow, subprocessor list, retention policy, and DPA for pilots.”

Once you actually engage an auditor or compliance platform, you can say:

> “SOC 2 Type I is underway.”

### Target timeline

| Stage                       |              Realistic timing | Why                                                      |
| --------------------------- | ----------------------------: | -------------------------------------------------------- |
| Internal SOC-ready controls |                Now to 2 weeks | Needed before live candidates anyway.                    |
| Readiness assessment        |                     2-6 weeks | Finds gaps before you embarrass yourself professionally. |
| SOC 2 Type I                |                    6-12 weeks | Useful for early enterprise procurement.                 |
| SOC 2 Type II               | After 3-6+ months of evidence | Larger customers will prefer this.                       |

### First SOC 2 scope

Scope it around the production candidate-interview system:

```text
Platform web app
Backend API
Agent worker
Production database
S3 artifact storage
LiveKit/media provider integration
Model/voice providers
CI/CD
GitHub
AWS account
Secrets Manager
CloudWatch/logging
Admin/reviewer access
Incident response
Vendor management
```

Start with:

```text
Security: yes
Confidentiality: yes
Availability: later, unless you promise uptime
Processing Integrity: later, once scoring exists
Privacy: product controls now, SOC criterion later if customers require it
```

## The employment/AI compliance posture for launch

For next week, the product should be positioned as:

> **AI-conducted structured interviews for human review.**

Not:

> **AI candidate evaluation.**

Not:

> **AI scoring.**

Not:

> **AI screening decision.**

Not:

> **AI hiring recommendation.**

This distinction matters. The more your system ranks, scores, recommends, filters, or substantially assists a decision, the more you walk into AEDT / employment selection / discrimination / validation territory. NYC’s AEDT law is one concrete example, and the EEOC/DOJ ADA warning is broader than NYC. ([NYC.gov][2]) ([EEOC][3])

For next week:

* The agent asks fixed questions.
* The agent can ask limited clarifiers.
* The agent records/transcribes.
* A human reviews.
* The customer makes decisions outside your product.
* No model-generated candidate quality labels.
* No “recommended / not recommended.”
* No facial, emotion, gaze, accent, personality, or confidence scoring.

Use NIST AI RMF as your internal AI governance skeleton. NIST says the AI RMF is voluntary and intended to help organizations manage risks to individuals, organizations, and society from AI systems. ([NIST][7]) That is the right framing for your AI risk register.

## What you should realistically do before live candidates next week

### 1. Lock down backend access

This is the biggest technical blocker.

Do **not** expose unauthenticated session-creation endpoints publicly.

Minimum acceptable version:

```text
Candidate-facing routes: public, tokenized, limited
Admin routes: authenticated
Integration/session creation routes: HMAC/API key protected
Internal orchestration routes: private network only
```

For next week, simplest safe design:

```text
Admin creates candidate session manually or through protected admin UI.
Candidate receives single-use signed invite link.
Candidate cannot create arbitrary sessions.
Backend only creates LiveKit token after invite validation + consent.
```

If you cannot implement full platform auth in time, use one of:

```text
Cloudflare Access in front of admin/backend
ALB private ingress for internal routes
HMAC middleware for integration endpoints
Temporary allowlist for design partner callbacks
```

Not pretty. Effective. Most good early infra looks like a clean splint, not a cathedral.

### 2. Add `/healthz`

This is boring and mandatory.

Add:

```http
GET /healthz
200 OK
{
  "status": "ok",
  "service": "backend",
  "version": "...",
  "timestamp": "..."
}
```

Do not check deep dependencies in the basic ALB health endpoint. A DB hiccup should not necessarily cause ECS to murder every task in a deployment spiral. Have:

```text
/healthz        shallow service health
/readyz         dependency readiness
/livez          process liveness
```

For next week, at least `/healthz`.

### 3. Decide your platform hosting shape

Because `platform/` exists and is Next.js, treat it as first-class.

For next week, I would use:

```text
Platform Next.js container on ECS
Backend API on ECS
Candidate and reviewer web behind the same domain or clean subdomains
```

Do **not** static export unless you are certain the app does not need server routes, auth cookies, protected review pages, or signed URL generation. It probably does. Dashboards always grow server-side teeth when nobody is looking.

### 4. Add Dockerfiles and image build path

Before ECS service deployment:

```text
backend/Dockerfile
agent/Dockerfile
platform/Dockerfile
ECR repos
GitHub Actions build/push
image tags by git SHA
rollback path
```

For next week, manual deploys are acceptable only if deterministic:

```text
build image
push SHA tag
update ECS service
verify health
smoke test
```

No “latest” tag in production. “latest” is not a version. It is a cry for help.

### 5. Fix the agent production command

If LiveKit worker launcher exists, the infra doc should stop pretending it does not.

Use a production command shape like:

```bash
python -m agent.worker start
```

or whatever your actual launcher supports, but the key is:

```text
dev mode locally
start/production mode in ECS
```

The agent should receive:

```text
LIVEKIT_URL
LIVEKIT_API_KEY
LIVEKIT_API_SECRET
BACKEND_API_URL
AGENT_AUTH_SECRET
ENVIRONMENT
LOG_LEVEL
```

### 6. Make Supabase a conscious decision, not a shrug

The feedback says Supabase may be too soft for real candidate data. That is directionally right, but I would not panic-migrate to RDS this week unless RDS is already basically done.

For next week:

**Acceptable:** Supabase for controlled live beta if hardened.

**Not acceptable:** Supabase as a mystery box with service role keys floating around, no DPA, no retention plan, no backups, no RLS thought, and production data mixed with dev.

Minimum Supabase posture:

```text
Separate prod Supabase project
No dev/prod data mixing
Service role key only server-side
RLS reviewed where applicable
Database backups enabled
TLS enforced
Minimal candidate PII
No VODs stored in Supabase
VODs in S3
Signed URLs only
Access logs where possible
Deletion workflow documented
DPA/subprocessor status checked
```

Longer term, yes, move candidate data into AWS RDS/Aurora if your strategy is AWS-contained data plane. But a rushed database migration right before live candidates is also how founders learn the difference between “secure” and “down.”

### 7. Create the candidate consent wall

Before mic/camera or recording starts:

Candidate must see and affirm:

```text
This interview is conducted by an AI system.
This interview will be recorded.
Audio, video, transcript, and related metadata may be stored and reviewed by authorized human reviewers.
The interview is part of the hiring process for [Company].
You may request accommodation or support if needed.
```

Store:

```text
candidate_id
session_id
consent_text_version
timestamp
IP address
user agent
checkbox values
customer/company
recording_policy_version
privacy_notice_version
```

This is not optional. Consent records are your shield. Thin shield, still shield.

### 8. Add an accommodation path

You need candidate-facing language like:

```text
If you need an accommodation or cannot complete an AI/video interview, contact [email] before starting.
```

Why? EEOC/DOJ specifically warn that AI/software employment tools can disadvantage disabled applicants, including by screening people out or creating disability-related inquiry issues. ([EEOC][3])

For next week, the accommodation process can be manual. But it must exist.

### 9. Make review access private

Reviewers should authenticate before seeing recordings/transcripts.

Minimum:

```text
Reviewer login required
Reviewer belongs to org
Session belongs to org
Signed S3 URL expires quickly
No public bucket
No permanent media URLs in frontend logs
Audit every playback/open/download
```

Absolutely no direct public S3 links. We are not doing “security by URL nobody guesses.” That’s not security; that’s a scavenger hunt.

### 10. Create an incident plan

One page is enough.

Include:

```text
Who gets paged
What counts as an incident
How to disable new interviews
How to revoke candidate links
How to disable recording/review access
How to rotate secrets
How to notify customer
How to preserve logs
```

You do not need a 40-page enterprise incident program next week. You need a real procedure the team can follow while sleep-deprived and mildly panicking.

## Launch mode I would use next week

### The only launch mode I’d approve

```text
Private beta
1-3 design partners max
10-20 candidates/day max at first
Manual session creation
Human monitoring during interview windows
Manual review of every completed interview
No automated scoring
No self-serve customer onboarding
No Zoom/Meet integration
No avatar
No India region yet
```

### Daily launch process

Before interviews:

```text
Check ECS service health
Check agent workers
Check LiveKit connectivity
Check recording egress
Check S3 write/read
Check database
Check error dashboard
Run one synthetic interview
```

During interviews:

```text
Watch active session dashboard
Monitor agent join failures
Monitor recording start failures
Monitor candidate disconnects
Keep support channel open
```

After interviews:

```text
Confirm recording finalized
Confirm transcript exists
Confirm review page loads
Check audit events
Review failures manually
Delete/retry failed artifacts as needed
```

This is unglamorous. It is also how you avoid waking up to “we interviewed 30 candidates and recorded none of them.” Tiny detail, apparently important.

## The security packet you need now

Have this ready before a customer asks.

```text
1. Architecture overview
2. Data flow diagram
3. Subprocessor list
4. Data retention policy
5. Deletion policy
6. Security controls summary
7. Encryption summary
8. Access control summary
9. Incident response summary
10. AI-use and human-review statement
11. Candidate consent/disclosure text
12. DPA template
13. Privacy policy
14. Vulnerability reporting contact
15. SOC 2 readiness statement
```

Subprocessors likely include:

```text
AWS
LiveKit
Supabase, if used
LLM provider
STT/TTS provider
Email provider
Observability/logging provider
Auth provider
```

Do not hide subprocessors. Customers will ask. Better to look organized than to look like you discovered your own stack during procurement.

## What not to build before next week

Do not build:

```text
SOC 2 audit
RDS migration unless already ready
Temporal if not already wired
Redis if not needed
EKS
multi-region
India server
Zoom/Meet integration
avatar layer
automated scoring
candidate ranking
ATS integration
self-serve customer admin
advanced analytics
```

The goal next week is **safe interviews**, not “enterprise platform cosplay.”

## What to build immediately after next week

Once the first live candidates run safely:

### Week 2

```text
Harden auth/RBAC
Improve review dashboard
Add QA flags
Add recording retry workflows
Add deletion/retention automation
Add better operational dashboard
Start SOC 2 readiness tool or auditor conversations
```

### Weeks 3-4

```text
RDS/Aurora decision
Formal vendor register
Formal policy set
Access reviews
Backup restore test
Vulnerability scanning
Pentest-lite or external security review
Load test concurrent interviews
```

### Month 2

```text
SOC 2 Type I readiness
Customer-facing security portal
Better human review workflow
Structured transcript by question
AI risk register
Evaluation harness for interview fidelity
```

### Month 3+

```text
SOC 2 Type I audit
Scoring design, still not production
Bias/legal review
ATS integrations
More regions if justified
Zoom/Meet adapter if customers demand it
```

## My final call

The SOC 2 answer you got is **mostly right but too abstract**.

Here is the real operating decision:

> **Do not block next week’s controlled beta on SOC 2. Do block it on auth, consent, recording security, retention, manual review, and no automated hiring decisions.**

For next week, your launch standard should be:

```text
Can a candidate safely complete an AI-led recorded interview?
Can the recording/transcript be reviewed only by authorized humans?
Can you prove what happened?
Can you delete or restrict data?
Can you explain your vendors and data flow?
Can you shut it down fast if something breaks?
```

If yes, launch the controlled beta.

If no, fix those before sending live candidate links.

SOC 2 is coming. Start now. But next week’s real compliance posture is: **small rollout, explicit consent, secure-by-default infra, human review only, no scoring, no public unauthenticated backend, and every session auditable.**

[1]: https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance-greater-than-soc-2 " System and Organization Controls: SOC Suite of Services | Resources | AICPA & CIMA "
[2]: https://www.nyc.gov/site/dca/about/automated-employment-decision-tools.page "Automated Employment Decision Tools (AEDT) - DCWP"
[3]: https://www.eeoc.gov/newsroom/us-eeoc-and-us-department-justice-warn-against-disability-discrimination "U.S. EEOC and U.S. Department of Justice Warn against Disability Discrimination | U.S. Equal Employment Opportunity Commission"
[4]: https://www.rcfp.org/reporters-recording-guide/ "Reporter's Recording Guide | The Reporters Committee"
[5]: https://www.eeoc.gov/employers/recordkeeping-requirements "Recordkeeping Requirements | U.S. Equal Employment Opportunity Commission"
[6]: https://oag.ca.gov/privacy/ccpa "California Consumer Privacy Act (CCPA) | State of California - Department of Justice - Office of the Attorney General"
[7]: https://www.nist.gov/itl/ai-risk-management-framework "AI Risk Management Framework | NIST"

