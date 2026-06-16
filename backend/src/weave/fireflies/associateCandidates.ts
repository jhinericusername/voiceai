import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_EXCLUDED_EXTERNAL_EMAILS = [
  "app@mintybridge.com",
  "fire+cal.com@incendiary.media",
] as const;

type CsvRecord = Record<string, string>;

export interface FirefliesExternalRecording {
  readonly firefliesTranscriptId: string;
  readonly meetingDate: string | null;
  readonly title: string | null;
  readonly externalEmails: string[];
}

export interface CandidateApplicationContext {
  readonly ashbyCandidateId: string;
  readonly ashbyApplicationId: string;
  readonly ashbyJobId: string | null;
  readonly candidateName: string;
  readonly primaryEmail: string | null;
  readonly emailAddresses: string[];
  readonly profileUrl: string | null;
  readonly applicationStatus: string | null;
  readonly currentInterviewStageTitle: string | null;
  readonly applicationCreatedAt: string | null;
  readonly applicationArchivedAt: string | null;
  readonly evaluationInterviewDate: string | null;
  readonly evaluationCandidateName: string | null;
  readonly evaluationSum: string | null;
  readonly stageTitles: string[];
  readonly stageEnteredDates: string[];
}

export interface RankedCandidateApplication extends CandidateApplicationContext {
  readonly matchedExternalEmail: string;
  readonly score: number;
  readonly confidence: "high" | "medium" | "low";
  readonly reasons: string[];
}

export interface AssociationSuggestion {
  readonly firefliesTranscriptId: string;
  readonly meetingDate: string | null;
  readonly title: string | null;
  readonly externalEmail: string;
  readonly suggested: RankedCandidateApplication | null;
  readonly alternatives: RankedCandidateApplication[];
}

interface CandidatePoolSqlOptions {
  readonly afterDate: string;
}

interface ExtractOptions {
  readonly excludedEmails?: readonly string[];
}

interface CliOptions {
  readonly reviewCsv?: string;
  readonly candidates?: string;
  readonly outCsv?: string;
  readonly outJson?: string;
  readonly afterDate: string;
  readonly top: number;
  readonly llmCommand?: string;
  readonly printCandidateSql: boolean;
}

export function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }
  return email;
}

export function parseCsv(text: string): CsvRecord[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(field);
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      field = "";
      continue;
    }

    field += char ?? "";
  }

  row.push(field);
  if (row.some((value) => value.length > 0)) {
    rows.push(row);
  }

  const header = rows[0];
  if (!header) {
    return [];
  }

  return rows.slice(1).map((values) => {
    const record: CsvRecord = {};
    header.forEach((key, index) => {
      record[key] = values[index] ?? "";
    });
    return record;
  });
}

export function stringifyCsv(records: readonly CsvRecord[]): string {
  const header = Array.from(
    records.reduce<Set<string>>((keys, record) => {
      Object.keys(record).forEach((key) => keys.add(key));
      return keys;
    }, new Set()),
  );

  const lines = [header.map(escapeCsvField).join(",")];
  for (const record of records) {
    lines.push(header.map((key) => escapeCsvField(record[key] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function extractUnmatchedExternalAttendees(
  rows: readonly CsvRecord[],
  options: ExtractOptions = {},
): FirefliesExternalRecording[] {
  const excluded = new Set(
    (options.excludedEmails ?? DEFAULT_EXCLUDED_EXTERNAL_EMAILS)
      .map((email) => normalizeEmail(email))
      .filter((email): email is string => email !== null),
  );
  const byTranscript = new Map<string, FirefliesExternalRecording>();

  for (const row of rows) {
    if ((row.match_status ?? "").toLowerCase() !== "unmatched") {
      continue;
    }

    const transcriptId = row.fireflies_transcript_id?.trim();
    if (!transcriptId) {
      continue;
    }

    const externalEmails = splitEmailList(row.attendee_emails ?? "")
      .map((email) => normalizeEmail(email))
      .filter((email): email is string => email !== null)
      .filter((email) => !email.endsWith("@workweave.ai"))
      .filter((email) => !excluded.has(email));

    if (externalEmails.length === 0) {
      continue;
    }

    const existing = byTranscript.get(transcriptId);
    const mergedEmails = new Set(existing?.externalEmails ?? []);
    externalEmails.forEach((email) => mergedEmails.add(email));

    byTranscript.set(transcriptId, {
      firefliesTranscriptId: transcriptId,
      meetingDate: normalizeNullable(row.meeting_date),
      title: normalizeNullable(row.title),
      externalEmails: Array.from(mergedEmails).sort(),
    });
  }

  return Array.from(byTranscript.values());
}

export function generateCandidatePoolSql(options: CandidatePoolSqlOptions): string {
  const afterDate = assertDateLiteral(options.afterDate);
  return `
WITH matched_candidates AS (
  SELECT DISTINCT ashby_candidate_id
  FROM weave_fireflies_recordings
  WHERE match_status = 'matched'
    AND ashby_candidate_id IS NOT NULL
),
matched_applications AS (
  SELECT DISTINCT ashby_application_id
  FROM weave_fireflies_recordings
  WHERE match_status = 'matched'
    AND ashby_application_id IS NOT NULL
),
candidate_email_values AS (
  SELECT c.ashby_candidate_id, lower(trim(c.primary_email)) AS email
  FROM ashby_candidates c
  WHERE c.primary_email IS NOT NULL AND trim(c.primary_email) <> ''
  UNION
  SELECT c.ashby_candidate_id,
         lower(trim(coalesce(
           CASE WHEN jsonb_typeof(email_item.value) = 'string' THEN email_item.value #>> '{}' END,
           email_item.value ->> 'email',
           email_item.value ->> 'value',
           email_item.value ->> 'address'
         ))) AS email
  FROM ashby_candidates c
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(c.email_addresses) = 'array' THEN c.email_addresses ELSE '[]'::jsonb END
  ) AS email_item(value)
),
evaluation_context AS (
  SELECT DISTINCT ON (ev.ashby_application_id)
    ev.ashby_application_id,
    ev.interview_date,
    ev.candidate_name,
    ev.sum
  FROM candidate_evaluations ev
  WHERE ev.interview_date >= DATE '${afterDate}'
  ORDER BY ev.ashby_application_id, ev.interview_date DESC NULLS LAST, ev.updated_at DESC
),
stage_context AS (
  SELECT
    h.ashby_application_id,
    array_remove(array_agg(DISTINCT h.title ORDER BY h.title), NULL) AS stage_titles,
    array_remove(array_agg(DISTINCT h.entered_stage_at::date::text ORDER BY h.entered_stage_at::date::text), NULL) AS stage_entered_dates,
    max(h.entered_stage_at::date) AS last_stage_entered_date
  FROM ashby_application_stage_history h
  WHERE lower(coalesce(h.title, '')) ~ '(screen|interview|chat|top grade|take home)'
  GROUP BY h.ashby_application_id
),
candidate_pool AS (
  SELECT
    app.ashby_candidate_id AS "ashbyCandidateId",
    app.ashby_application_id AS "ashbyApplicationId",
    app.ashby_job_id AS "ashbyJobId",
    c.name AS "candidateName",
    c.primary_email AS "primaryEmail",
    array_remove(array_agg(DISTINCT cev.email), NULL) AS "emailAddresses",
    c.profile_url AS "profileUrl",
    app.status AS "applicationStatus",
    app.current_interview_stage_title AS "currentInterviewStageTitle",
    app.ashby_created_at::date::text AS "applicationCreatedAt",
    app.archived_at::date::text AS "applicationArchivedAt",
    ev.interview_date::text AS "evaluationInterviewDate",
    ev.candidate_name AS "evaluationCandidateName",
    ev.sum::text AS "evaluationSum",
    coalesce(stage.stage_titles, '{}'::text[]) AS "stageTitles",
    coalesce(stage.stage_entered_dates, '{}'::text[]) AS "stageEnteredDates"
  FROM ashby_applications app
  JOIN ashby_candidates c
    ON c.ashby_candidate_id = app.ashby_candidate_id
  LEFT JOIN candidate_email_values cev
    ON cev.ashby_candidate_id = c.ashby_candidate_id
   AND cev.email ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
  LEFT JOIN evaluation_context ev
    ON ev.ashby_application_id = app.ashby_application_id
  LEFT JOIN stage_context stage
    ON stage.ashby_application_id = app.ashby_application_id
  WHERE NOT EXISTS (
      SELECT 1
      FROM matched_candidates
      WHERE matched_candidates.ashby_candidate_id = c.ashby_candidate_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM matched_applications
      WHERE matched_applications.ashby_application_id = app.ashby_application_id
    )
    AND (
      app.ashby_created_at::date >= DATE '${afterDate}'
      OR ev.interview_date >= DATE '${afterDate}'
      OR stage.last_stage_entered_date >= DATE '${afterDate}'
    )
  GROUP BY
    app.ashby_candidate_id,
    app.ashby_application_id,
    app.ashby_job_id,
    c.name,
    c.primary_email,
    c.profile_url,
    app.status,
    app.current_interview_stage_title,
    app.ashby_created_at,
    app.archived_at,
    ev.interview_date,
    ev.candidate_name,
    ev.sum,
    stage.stage_titles,
    stage.stage_entered_dates
)
SELECT row_to_json(candidate_pool)
FROM candidate_pool
ORDER BY "candidateName", "applicationCreatedAt", "ashbyApplicationId";
`.trim();
}

export function rankCandidateApplications(
  recording: FirefliesExternalRecording,
  candidates: readonly CandidateApplicationContext[],
): RankedCandidateApplication[] {
  const ranked: RankedCandidateApplication[] = [];

  for (const candidate of candidates) {
    let best: RankedCandidateApplication | null = null;
    for (const externalEmail of recording.externalEmails) {
      const scored = scoreCandidate(recording, externalEmail, candidate);
      if (scored.score === 0) {
        continue;
      }
      if (!best || scored.score > best.score) {
        best = scored;
      }
    }
    if (best) {
      ranked.push(best);
    }
  }

  return ranked
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.candidateName.localeCompare(right.candidateName);
    })
    .map((candidate, index, all) => ({
      ...candidate,
      confidence: confidenceFor(candidate.score, candidate.score - (all[index + 1]?.score ?? 0)),
    }));
}

export async function buildAssociationSuggestions(
  recordings: readonly FirefliesExternalRecording[],
  candidates: readonly CandidateApplicationContext[],
  options: { readonly top?: number; readonly llmCommand?: string } = {},
): Promise<AssociationSuggestion[]> {
  const top = options.top ?? 5;
  const suggestions: AssociationSuggestion[] = [];

  for (const recording of recordings) {
    const ranked = rankCandidateApplications(recording, candidates).slice(0, Math.max(top, 1));
    for (const externalEmail of recording.externalEmails) {
      const alternatives = ranked.filter((candidate) => candidate.matchedExternalEmail === externalEmail).slice(0, top);
      const llmSelected = options.llmCommand
        ? await selectWithLlmCommand(options.llmCommand, recording, externalEmail, alternatives)
        : null;
      suggestions.push({
        firefliesTranscriptId: recording.firefliesTranscriptId,
        meetingDate: recording.meetingDate,
        title: recording.title,
        externalEmail,
        suggested: llmSelected ?? alternatives[0] ?? null,
        alternatives,
      });
    }
  }

  return suggestions;
}

export async function readCandidatePool(path: string): Promise<CandidateApplicationContext[]> {
  const text = await readFile(path, "utf8");
  const extension = extname(path).toLowerCase();
  if (extension === ".csv") {
    return parseCsv(text).map(candidateFromRecord);
  }
  if (extension === ".jsonl") {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => candidateFromRecord(JSON.parse(line) as CsvRecord));
  }
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected ${path} to contain a JSON array`);
  }
  return parsed.map((value) => candidateFromRecord(value as CsvRecord));
}

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  if (options.printCandidateSql) {
    process.stdout.write(`${generateCandidatePoolSql({ afterDate: options.afterDate })}\n`);
    return;
  }

  if (!options.reviewCsv || !options.candidates) {
    throw new Error("Usage: associateCandidates --review-csv <path> --candidates <path> [--out-csv <path>] [--out-json <path>] [--after-date YYYY-MM-DD] [--top N] [--llm-command <cmd>]");
  }

  const reviewRows = parseCsv(await readFile(options.reviewCsv, "utf8"));
  const recordings = extractUnmatchedExternalAttendees(reviewRows);
  const candidates = await readCandidatePool(options.candidates);
  const suggestions = await buildAssociationSuggestions(recordings, candidates, {
    top: options.top,
    llmCommand: options.llmCommand,
  });

  const csvRows = suggestions.map((suggestion): CsvRecord => ({
    fireflies_transcript_id: suggestion.firefliesTranscriptId,
    meeting_date: suggestion.meetingDate ?? "",
    title: suggestion.title ?? "",
    external_email: suggestion.externalEmail,
    suggested_ashby_candidate_id: suggestion.suggested?.ashbyCandidateId ?? "",
    suggested_ashby_application_id: suggestion.suggested?.ashbyApplicationId ?? "",
    suggested_candidate_name: suggestion.suggested?.candidateName ?? "",
    suggested_primary_email: suggestion.suggested?.primaryEmail ?? "",
    suggested_profile_url: suggestion.suggested?.profileUrl ?? "",
    confidence: suggestion.suggested?.confidence ?? "",
    score: suggestion.suggested ? String(suggestion.suggested.score) : "",
    reasons: suggestion.suggested?.reasons.join(" | ") ?? "",
    alternatives_json: JSON.stringify(suggestion.alternatives),
  }));

  if (options.outCsv) {
    await writeFile(options.outCsv, stringifyCsv(csvRows));
  } else {
    process.stdout.write(stringifyCsv(csvRows));
  }

  if (options.outJson) {
    await writeFile(options.outJson, `${JSON.stringify(suggestions, null, 2)}\n`);
  }
}

function scoreCandidate(
  recording: FirefliesExternalRecording,
  externalEmail: string,
  candidate: CandidateApplicationContext,
): RankedCandidateApplication {
  let score = 0;
  const reasons: string[] = [];
  const candidateEmails = new Set(
    [candidate.primaryEmail, ...candidate.emailAddresses]
      .map((email) => normalizeEmail(email))
      .filter((email): email is string => email !== null),
  );

  if (candidateEmails.has(externalEmail)) {
    score += 100;
    reasons.push("exact_candidate_email_match");
  }

  const candidateTokens = personNameTokens(candidate.candidateName);
  const emailTokens = emailLocalTokens(externalEmail);
  const emailLocal = externalEmail.split("@")[0] ?? "";
  const normalizedEmailLocal = normalizeTokenText(emailLocal);
  const titleTokens = textTokens(recording.title ?? "");

  const first = candidateTokens[0];
  const last = candidateTokens[candidateTokens.length - 1];
  if (first && last && first !== last && normalizedEmailLocal.includes(first) && normalizedEmailLocal.includes(last)) {
    score += 60;
    reasons.push("email_local_part_matches_candidate_name");
  } else {
    if (first && tokenSetContainsNameToken(emailTokens, first)) {
      score += 20;
      reasons.push("email_local_part_matches_candidate_first_name");
    }
    if (last && tokenSetContainsNameToken(emailTokens, last)) {
      score += 25;
      reasons.push("email_local_part_matches_candidate_last_name");
    }
  }

  if (first && titleTokens.includes(first)) {
    score += 18;
    reasons.push("title_matches_candidate_first_name");
  }
  if (last && titleTokens.includes(last)) {
    score += 16;
    reasons.push("title_matches_candidate_last_name");
  }

  const dateScore = proximityScore(recording.meetingDate, candidate.evaluationInterviewDate);
  if (dateScore > 0) {
    score += dateScore;
    reasons.push(dateScore >= 25 ? "same_evaluation_interview_date" : "near_evaluation_interview_date");
  }

  const stageDateScore = Math.max(
    ...candidate.stageEnteredDates.map((date) => proximityScore(recording.meetingDate, date, { exact: 10, near: 8, far: 4 })),
    0,
  );
  if (stageDateScore > 0) {
    score += stageDateScore;
    reasons.push("near_relevant_stage_transition");
  }

  if (candidate.currentInterviewStageTitle || candidate.stageTitles.length > 0) {
    score += 5;
    reasons.push("has_interview_stage_context");
  }

  return {
    ...candidate,
    matchedExternalEmail: externalEmail,
    score,
    confidence: confidenceFor(score, 0),
    reasons,
  };
}

function confidenceFor(score: number, margin: number): "high" | "medium" | "low" {
  if (score >= 80 && margin >= 12) {
    return "high";
  }
  if (score >= 60) {
    return "medium";
  }
  return "low";
}

function proximityScore(
  meetingDate: string | null,
  candidateDate: string | null,
  weights: { readonly exact: number; readonly near: number; readonly far: number } = { exact: 25, near: 15, far: 8 },
): number {
  if (!meetingDate || !candidateDate) {
    return 0;
  }
  const meeting = Date.parse(`${meetingDate}T00:00:00.000Z`);
  const candidate = Date.parse(`${candidateDate}T00:00:00.000Z`);
  if (Number.isNaN(meeting) || Number.isNaN(candidate)) {
    return 0;
  }
  const days = Math.abs(Math.round((meeting - candidate) / 86_400_000));
  if (days === 0) {
    return weights.exact;
  }
  if (days <= 3) {
    return weights.near;
  }
  if (days <= 14) {
    return weights.far;
  }
  return 0;
}

function personNameTokens(name: string): string[] {
  return textTokens(name).filter((token) => token.length > 1);
}

function tokenSetContainsNameToken(tokens: readonly string[], nameToken: string): boolean {
  if (nameToken.length < 3) {
    return tokens.includes(nameToken);
  }
  return tokens.some((token) => token.includes(nameToken) || nameToken.includes(token));
}

function textTokens(value: string): string[] {
  return normalizeTokenText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function emailLocalTokens(email: string): string[] {
  const local = email.split("@")[0] ?? "";
  return normalizeTokenText(local.replace(/\+.*/, "")).split(/\s+/).filter(Boolean);
}

function normalizeTokenText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function splitEmailList(value: string): string[] {
  return value
    .split(/\s+\|\s+|[,;]/)
    .map((email) => email.trim())
    .filter(Boolean);
}

function normalizeNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function escapeCsvField(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

function assertDateLiteral(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date literal: ${value}`);
  }
  return value;
}

function candidateFromRecord(record: CsvRecord): CandidateApplicationContext {
  const source = record as Record<string, unknown>;
  return {
    ashbyCandidateId: requiredString(source.ashbyCandidateId ?? source.ashby_candidate_id, "ashbyCandidateId"),
    ashbyApplicationId: requiredString(source.ashbyApplicationId ?? source.ashby_application_id, "ashbyApplicationId"),
    ashbyJobId: optionalString(source.ashbyJobId ?? source.ashby_job_id),
    candidateName: requiredString(source.candidateName ?? source.candidate_name, "candidateName"),
    primaryEmail: optionalString(source.primaryEmail ?? source.primary_email),
    emailAddresses: stringArray(source.emailAddresses ?? source.email_addresses),
    profileUrl: optionalString(source.profileUrl ?? source.profile_url),
    applicationStatus: optionalString(source.applicationStatus ?? source.application_status),
    currentInterviewStageTitle: optionalString(
      source.currentInterviewStageTitle ?? source.current_interview_stage_title,
    ),
    applicationCreatedAt: optionalString(source.applicationCreatedAt ?? source.application_created_at),
    applicationArchivedAt: optionalString(source.applicationArchivedAt ?? source.application_archived_at),
    evaluationInterviewDate: optionalString(source.evaluationInterviewDate ?? source.evaluation_interview_date),
    evaluationCandidateName: optionalString(source.evaluationCandidateName ?? source.evaluation_candidate_name),
    evaluationSum: optionalString(source.evaluationSum ?? source.evaluation_sum),
    stageTitles: stringArray(source.stageTitles ?? source.stage_titles),
    stageEnteredDates: stringArray(source.stageEnteredDates ?? source.stage_entered_dates),
  };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required candidate field ${name}`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    }
    return trimmed
      .replace(/^\{|\}$/g, "")
      .split(/\s*\|\s*|\s*,\s*/)
      .map((item) => item.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
  }
  return [];
}

async function selectWithLlmCommand(
  command: string,
  recording: FirefliesExternalRecording,
  externalEmail: string,
  alternatives: readonly RankedCandidateApplication[],
): Promise<RankedCandidateApplication | null> {
  if (alternatives.length === 0) {
    return null;
  }
  const payload = JSON.stringify({ recording, externalEmail, alternatives }, null, 2);
  const response = await runCommandWithStdin(command, payload);
  if (!response.trim()) {
    return null;
  }
  const parsed = JSON.parse(response) as { ashbyApplicationId?: string; ashbyCandidateId?: string; rationale?: string };
  const selected = alternatives.find(
    (candidate) =>
      candidate.ashbyApplicationId === parsed.ashbyApplicationId ||
      candidate.ashbyCandidateId === parsed.ashbyCandidateId,
  );
  if (!selected) {
    return null;
  }
  return {
    ...selected,
    reasons: [...selected.reasons, parsed.rationale ? `llm_selected:${parsed.rationale}` : "llm_selected"],
  };
}

function runCommandWithStdin(command: string, stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-lc", command], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`LLM command exited ${code}: ${stderr}`));
      }
    });
    child.stdin.end(stdin);
  });
}

function parseArgs(argv: readonly string[]): CliOptions {
  const args = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key?.startsWith("--")) {
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, true);
    } else {
      args.set(key, next);
      index += 1;
    }
  }

  const afterDate = String(args.get("--after-date") ?? "2026-04-01");
  assertDateLiteral(afterDate);
  const top = Number(args.get("--top") ?? 5);
  if (!Number.isInteger(top) || top < 1 || top > 20) {
    throw new Error("--top must be an integer from 1 to 20");
  }

  return {
    reviewCsv: stringArg(args.get("--review-csv")),
    candidates: stringArg(args.get("--candidates")),
    outCsv: stringArg(args.get("--out-csv")),
    outJson: stringArg(args.get("--out-json")),
    afterDate,
    top,
    llmCommand: stringArg(args.get("--llm-command")),
    printCandidateSql: args.get("--print-candidate-sql") === true,
  };
}

function stringArg(value: string | true | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
