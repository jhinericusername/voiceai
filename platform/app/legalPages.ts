import type { LegalPageContent } from "./LegalPageShell";

const lastUpdated = "June 1, 2026";

export const privacyPage = {
  eyebrow: "Privacy",
  title: "Privacy notice for candidates and hiring teams.",
  description:
    "This notice explains how Puddle handles candidate, interview, and customer workspace data for AI-assisted structured interview and review workflows.",
  lastUpdated,
  sections: [
    {
      title: "What Puddle Collects",
      body: [
        "Puddle may collect account information, customer workspace information, candidate invite details, interview scheduling information, audio and video recordings, transcripts, rubric notes, rubric scores, draft rubric observations, rankings, recommendations, summaries, reviewer activity, device diagnostics, support messages, and security logs.",
        "Customers may also provide role rubrics, job context, candidate materials, source signals, and reviewer notes so Puddle can run a structured interview and produce review materials.",
      ],
    },
    {
      title: "How Puddle Uses Data",
      bullets: [
        "To create and operate candidate interview rooms.",
        "To record, transcribe, summarize, and organize interview records for the hiring team.",
        "To apply the customer-defined rubric and generate AI-assisted notes, transcript references, rubric scores, rankings, recommendations, draft rubric observations, and review materials for human review.",
        "To maintain security, debug the product, prevent misuse, and support customers and candidates.",
        "To comply with legal, contractual, accounting, or security obligations.",
      ],
    },
    {
      title: "AI Boundaries",
      body: [
        "Puddle is designed to support structured hiring review. Puddle may generate rubric scores, ranked lists, recommendations, draft observations, and other decision-support materials for the hiring team. Puddle does not itself hire, reject, or communicate employment outcomes to candidates. Hiring companies are responsible for reviewing interview materials, providing any required human review or reconsideration process, and deciding how candidates move through their process.",
        "Facial recognition, emotion recognition, voiceprint identification, attractiveness, facial expression, eye movement, accent, race, color, religion, sex, pregnancy, childbirth or related medical conditions, national origin, citizenship or immigration status where protected, age, disability, genetic information, sexual orientation, gender identity, veteran status, arrest or conviction record where protected, zip code, and other protected characteristics or proxies are not inputs for rubric scores, rankings, recommendations, or job-fit outputs.",
      ],
    },
    {
      title: "Session Diagnostics",
      body: [
        "Puddle may process limited session data to operate and secure the interview room, such as connection quality, device and browser diagnostics, microphone and camera permission status, session start and end timestamps, reconnects, interruptions, and recording status.",
        "Puddle should not treat session diagnostics as a substitute for job-related answers or customer-defined rubric criteria.",
      ],
    },
    {
      title: "Sharing and Subprocessors",
      body: [
        "Puddle shares data with the customer that invited the candidate and with service providers that help run the product, such as cloud hosting, authentication, email, live video, storage, analytics, support, and AI model providers.",
        "Puddle does not sell candidate personal information or interview recordings, and does not share candidate personal information for cross-context behavioral advertising. Customer agreements may further restrict how customer and candidate data is processed, retained, exported, or deleted.",
      ],
    },
    {
      title: "Retention and Deletion",
      body: [
        "Puddle retains candidate data for the period needed to provide the service, support customer review, maintain security records, and satisfy legal or contractual obligations. Customer agreements may set shorter or longer retention periods for particular data categories.",
        "Candidates or customers may request deletion by contacting Puddle. Some records may need to be retained when required by law, customer employment-record obligations, dispute preservation, fraud prevention, backup restoration cycles, or security recordkeeping.",
      ],
    },
    {
      title: "Candidate Rights and Accommodation",
      body: [
        "The hiring company usually determines the purposes of the interview and is the primary contact for employment-related requests. Puddle helps process candidate requests as required by customer agreements and applicable law.",
        "Candidates may contact Puddle or the hiring company to request access, correction, deletion, accommodation, or an alternative interview process. Candidates should not be penalized for requesting a reasonable accommodation or legally required alternative process.",
      ],
    },
    {
      title: "Jurisdiction-Specific Notices",
      body: [
        "Some locations may require additional candidate notices, consent language, bias-audit information, automated-decision disclosures, deletion rights, appeal or reconsideration rights, or alternative-process information, especially when AI-assisted scores, rankings, or recommendations are used in hiring review. The hiring company is responsible for providing location-specific notices required for its hiring process, and Puddle is designed to support those workflows where configured.",
      ],
    },
  ],
} satisfies LegalPageContent;

export const termsPage = {
  eyebrow: "Terms",
  title: "Terms for using Puddle.",
  description:
    "These terms describe the baseline rules for customers, candidates, and visitors using Puddle's AI-assisted structured interview and review workflow.",
  lastUpdated,
  sections: [
    {
      title: "Service Description",
      body: [
        "Puddle provides tools for customers to configure hiring rubrics, invite candidates, conduct AI-assisted structured interviews, record and transcribe sessions, and review candidate materials, including rubric scores, rankings, and recommendations where configured.",
        "Puddle outputs are decision-support materials. Customers are responsible for their hiring criteria, notices, consents, accommodations, human review, employment decisions, and compliance obligations.",
      ],
    },
    {
      title: "Customer Responsibilities",
      bullets: [
        "Use Puddle only with lawful, job-related hiring criteria.",
        "Provide any candidate notices, consents, disclosures, accommodations, bias-audit materials, or alternative processes required by applicable law.",
        "Maintain appropriate human review and do not treat AI-assisted scores, rankings, recommendations, or other outputs as the sole basis for employment decisions.",
        "Avoid using Puddle to infer or act on protected characteristics or non-job-related traits.",
        "Keep account credentials secure and promptly report suspected unauthorized access.",
      ],
    },
    {
      title: "Candidate Participation Guidelines",
      body: [
        "Candidates should provide accurate information, avoid impersonation, and follow the instructions shown before and during the interview.",
        "Candidates may contact Puddle or the hiring company if they need accommodation, cannot use the interview room, or want to understand how interview data will be handled.",
      ],
    },
    {
      title: "Prohibited Uses",
      bullets: [
        "Using Puddle outputs as the sole basis to reject, select, advance, or make employment decisions without required human review.",
        "Using Puddle to evaluate protected characteristics, facial expression, emotion, appearance, disability, race, gender, age, accent, zip code, or other protected or non-job-related traits.",
        "Uploading unlawful, infringing, malicious, or deceptive content.",
        "Attempting to bypass security controls, access another customer's data, or disrupt the service.",
      ],
    },
    {
      title: "Data and AI Outputs",
      body: [
        "Customers retain responsibility for customer-provided content, role rubrics, candidate materials, reviewer notes, scores, rankings, recommendations, and hiring decisions. Puddle may process that content to provide, secure, support, and improve the service as described in customer agreements and privacy notices.",
        "Puddle does not use customer content or candidate interview data to train general-purpose AI models unless expressly authorized in the applicable customer agreement or consent.",
        "AI outputs can be incomplete or incorrect. Customers should verify outputs against the recording, transcript, rubric, and other relevant evidence before relying on them.",
      ],
    },
    {
      title: "Disclaimers and Limits",
      body: [
        "Puddle is provided for structured interview operations and evidence review. It is not legal advice, employment advice, or a guarantee of hiring outcomes.",
        "Additional commercial terms, data processing terms, service levels, security commitments, and order-form terms may apply to customers who buy or pilot Puddle.",
      ],
    },
  ],
} satisfies LegalPageContent;

export const aiInterviewDisclosurePage = {
  eyebrow: "AI interview disclosure",
  title: "What candidates should know before a Puddle interview.",
  description:
    "This page explains the AI interview flow, what is recorded, how rubric-based outputs are used, and how candidates can request help or an alternative process.",
  lastUpdated,
  sections: [
    {
      title: "What Happens in the Interview",
      body: [
        "A Puddle interview is a structured video conversation conducted by an AI interviewer. The interviewer asks role-related questions based on the hiring company's rubric and interview setup.",
        "The session may be recorded and transcribed so the hiring team can review what happened instead of relying only on a short summary.",
        "Puddle may create rubric scores, ranked lists, recommendations, and review materials for the hiring team. Puddle does not itself hire, reject, or communicate employment outcomes to candidates.",
      ],
    },
    {
      title: "What the AI Does",
      bullets: [
        "Asks structured, role-related interview questions.",
        "May ask follow-up questions to clarify an answer.",
        "Creates transcripts, summaries, rubric notes, rubric scores, rankings, recommendations, draft rubric observations, and structured interview packets for the hiring team.",
        "Helps organize information so human reviewers can compare candidates against the same rubric and decide what happens next.",
      ],
    },
    {
      title: "What the AI Should Not Do",
      bullets: [
        "Automatically reject, select, advance, or make employment decisions without hiring-company review.",
        "Score candidates based on facial expression, emotion, appearance, race, age, gender, disability, accent, or other protected or non-job-related characteristics.",
        "Replace a legally required accommodation, human review, or alternative process.",
      ],
    },
    {
      title: "What Puddle Does Not Analyze",
      body: [
        "Facial recognition, emotion recognition, voiceprint identification, attractiveness, facial expression, eye movement, accent, race, gender, age, disability, and other protected characteristics are not inputs for rubric scores, rankings, recommendations, or job-fit outputs.",
      ],
    },
    {
      title: "Recording and Data Use",
      body: [
        "Puddle may process audio, video, transcripts, timing information, connection quality, device and browser diagnostics, microphone and camera permission status, session start and end timestamps, reconnects, interruptions, and recording status to run the interview, create review materials, generate rubric scores, rankings, and recommendations, maintain security, and troubleshoot the service.",
        "The hiring company that invited the candidate receives or controls the interview record and is responsible for using it lawfully in its hiring process.",
      ],
    },
    {
      title: "Accommodation and Alternatives",
      body: [
        "Candidates who need accommodation, cannot use camera or microphone access, or prefer an alternative process should contact the hiring company or Puddle before starting the interview.",
        "A candidate should not be penalized for requesting an accommodation or legally required alternative process.",
      ],
    },
  ],
} satisfies LegalPageContent;

export const subprocessorsPage = {
  eyebrow: "Subprocessors",
  title: "Subprocessors and service providers.",
  description:
    "This page identifies the core service providers Puddle may use to run authentication, hosting, live video, recording, transcription, speech, and AI-assisted review workflows.",
  lastUpdated,
  sections: [
    {
      title: "Current Service Providers",
      bullets: [
        "Amazon Web Services: cloud hosting, networking, storage, database, container registry, logs, secrets, and related infrastructure.",
        "WorkOS: customer authentication, session management, and account invitation workflows.",
        "LiveKit: live audio/video rooms, participant connectivity, agent dispatch, and recording or egress workflows where enabled.",
        "Anthropic: AI-assisted rubric review, follow-up question generation, ranking or recommendation support, and related model processing where enabled.",
        "Deepgram: speech-to-text processing where enabled.",
        "Cartesia: text-to-speech processing where enabled.",
      ],
    },
    {
      title: "Data Handled",
      body: [
        "Subprocessors may process account identifiers, workspace data, candidate invite details, audio, video, transcripts, session events, device diagnostics, customer-provided rubrics, AI prompts and outputs, logs, and support information depending on how the customer configures Puddle.",
      ],
    },
    {
      title: "Updates",
      body: [
        "Puddle may update this list as service providers change. Customer agreements may include additional notice, objection, regional hosting, or data-transfer terms.",
      ],
    },
  ],
} satisfies LegalPageContent;
