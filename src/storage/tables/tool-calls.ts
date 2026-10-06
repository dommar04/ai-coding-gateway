import { safeStringify } from "../../helpers/json";
import { sql } from "../database";

// Table tool_calls: the call log. One row per tool call; written before the call (decision) and
// completed after it (result, tokens).

export interface ToolCallRow {
  integration: string;
  id: number;
  tool_use_id: string;
  session_id: string | null;
  agent_id: string | null;
  prompt_id: string | null;
  transcript_path: string | null;
  project: string | null;
  tool_name: string;
  tool_input: string | null;
  decision: "allowed" | "denied" | "would_deny" | "observed";
  rule_id: number | null;
  input_rewrite: string | null;
  input_tokens: number | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  tool_result: string | null;
  reduced_result: string | null;
  result_tokens: number | null;
  result_tokens_after: number | null;
  reduction: string | null;
}

interface CallIdentity {
  integration?: string;
  toolUseId: string;
  sessionId: string;
  project: string;
  toolName: string;
  toolInput: unknown;
  promptId?: string;
  transcriptPath?: string;
  agentId?: string | null;
}

export interface CallStart extends CallIdentity {
  decision: "allowed" | "denied" | "would_deny";
  ruleId?: number | null;
  inputTokens?: number | null;
}

export interface CallEnd extends CallIdentity {
  toolResult: unknown;
  durationMs?: number | null;
  inputTokens?: number | null;
  resultTokens?: number | null;
  resultTokensAfter?: number | null;
  /** Per-strategy breakdown: [{ id, saved }]. */
  reduction?: unknown;
  /** What the agent actually received, when a strategy changed the result. */
  reducedResult?: unknown;
}

const json = (value: unknown) => (value === undefined ? null : safeStringify(value));

export function insertCall(c: CallStart): void {
  sql(
    `INSERT INTO tool_calls (tool_use_id, session_id, agent_id, prompt_id, transcript_path, project, tool_name, tool_input,
                             decision, rule_id, input_tokens, started_at, integration)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    c.toolUseId,
    c.sessionId,
    c.agentId ?? null,
    c.promptId ?? null,
    c.transcriptPath ?? null,
    c.project,
    c.toolName,
    safeStringify(c.toolInput),
    c.decision,
    c.ruleId ?? null,
    c.inputTokens ?? null,
    new Date().toISOString(),
    c.integration ?? "claude"
  );
}

/** Completes the row written before the call; without one (hook installed mid-session) it logs the call as "observed". */
export function completeCall(c: CallEnd): void {
  const now = new Date().toISOString();
  const updated = sql(
    `UPDATE tool_calls
        SET tool_result = ?, completed_at = ?, duration_ms = ?, result_tokens = ?, result_tokens_after = ?,
            reduction = ?, reduced_result = ?,
            input_tokens = COALESCE(input_tokens, ?), prompt_id = COALESCE(prompt_id, ?),
            transcript_path = COALESCE(transcript_path, ?), agent_id = COALESCE(agent_id, ?)
      WHERE tool_use_id = ? AND completed_at IS NULL`
  ).run(
    safeStringify(c.toolResult),
    now,
    c.durationMs ?? null,
    c.resultTokens ?? null,
    c.resultTokensAfter ?? null,
    json(c.reduction),
    json(c.reducedResult),
    c.inputTokens ?? null,
    c.promptId ?? null,
    c.transcriptPath ?? null,
    c.agentId ?? null,
    c.toolUseId
  );
  if (updated.changes > 0) return;
  sql(
    `INSERT INTO tool_calls (tool_use_id, session_id, agent_id, prompt_id, transcript_path, project, tool_name, tool_input,
                             decision, input_tokens, completed_at, duration_ms, tool_result, reduced_result, result_tokens,
                             result_tokens_after, reduction, integration)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'observed', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    c.toolUseId,
    c.sessionId,
    c.agentId ?? null,
    c.promptId ?? null,
    c.transcriptPath ?? null,
    c.project,
    c.toolName,
    safeStringify(c.toolInput),
    c.inputTokens ?? null,
    now,
    c.durationMs ?? null,
    safeStringify(c.toolResult),
    json(c.reducedResult),
    c.resultTokens ?? null,
    c.resultTokensAfter ?? null,
    json(c.reduction),
    c.integration ?? "claude"
  );
}

export function getCall(id: number): ToolCallRow | undefined {
  return sql(`SELECT * FROM tool_calls WHERE id = ?`).get(id) as unknown as ToolCallRow | undefined;
}

export function callIdForToolUse(toolUseId: string): number | null {
  const row = sql(`SELECT id FROM tool_calls WHERE tool_use_id = ? ORDER BY id DESC LIMIT 1`).get(toolUseId) as
    { id: number } | undefined;
  return row?.id ?? null;
}

export function listRecentCalls(limit: number, project?: string): ToolCallRow[] {
  return (project
    ? sql(`SELECT * FROM tool_calls WHERE project = ? ORDER BY id DESC LIMIT ?`).all(project, limit)
    : sql(`SELECT * FROM tool_calls ORDER BY id DESC LIMIT ?`).all(limit)) as unknown as ToolCallRow[];
}

/** Calls logged after `afterId`, oldest first (live feed). */
export function listCallsSince(afterId: number, limit = 500): ToolCallRow[] {
  return sql(`SELECT * FROM tool_calls WHERE id > ? ORDER BY id ASC LIMIT ?`).all(afterId, limit) as unknown as ToolCallRow[];
}

/** Calls that got their result after `afterIso` (live feed status updates). */
export function listCallsCompletedSince(afterIso: string, limit = 500): ToolCallRow[] {
  return sql(`SELECT * FROM tool_calls WHERE completed_at > ? ORDER BY completed_at ASC LIMIT ?`).all(
    afterIso,
    limit
  ) as unknown as ToolCallRow[];
}

export function lastCallId(): number {
  return (sql(`SELECT COALESCE(MAX(id), 0) AS id FROM tool_calls`).get() as { id: number }).id;
}

export function listCallsForPrompt(promptId: string, limit = 500): ToolCallRow[] {
  return sql(`SELECT * FROM tool_calls WHERE prompt_id = ? ORDER BY id ASC LIMIT ?`).all(
    promptId,
    limit
  ) as unknown as ToolCallRow[];
}

/** Projects (session working directories) with their call count and last activity, most recent first. */
export function listProjects(): Array<{ project: string; calls: number; lastAt: string | null }> {
  return sql(
    `SELECT project, SUM(is_call) AS calls, MAX(COALESCE(completed_at, started_at)) AS lastAt
       FROM (
         SELECT project, completed_at, started_at, 1 AS is_call FROM tool_calls
         UNION ALL
         SELECT project, NULL, submitted_at, 0 FROM prompts
       ) WHERE project IS NOT NULL AND project != '' GROUP BY project ORDER BY lastAt DESC`
  ).all() as unknown as Array<{ project: string; calls: number; lastAt: string | null }>;
}

// ---------- prompt groups ----------

export interface PromptGroupRow {
  integration: string;
  prompt_id: string;
  session_id: string | null;
  project: string | null;
  transcript_path: string | null;
  first_at: string | null;
  last_at: string | null;
  calls: number;
  denied: number;
  would_deny: number;
  input_tokens: number;
  result_tokens: number;
  saved_tokens: number;
}

const CALL_PROMPT_GROUP = `
  SELECT prompt_id, MAX(integration) AS integration, MAX(session_id) AS session_id, MAX(project) AS project, MAX(transcript_path) AS transcript_path,
         MIN(COALESCE(started_at, completed_at)) AS first_at, MAX(COALESCE(completed_at, started_at)) AS last_at,
         COUNT(*) AS calls, SUM(decision = 'denied') AS denied, SUM(decision = 'would_deny') AS would_deny,
         COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(result_tokens), 0) AS result_tokens,
         COALESCE(SUM(result_tokens - result_tokens_after), 0) AS saved_tokens
    FROM tool_calls`;

const PROMPT_GROUP = `SELECT * FROM (
  ${CALL_PROMPT_GROUP} WHERE prompt_id IS NOT NULL GROUP BY prompt_id
  UNION ALL
  SELECT p.prompt_id, p.integration, p.session_id, p.project, p.transcript_path,
    p.submitted_at, p.submitted_at, 0, 0, 0, 0, 0, 0
  FROM prompts p WHERE NOT EXISTS (SELECT 1 FROM tool_calls c WHERE c.prompt_id = p.prompt_id)
)`;

export function listPromptGroups(limit: number, project?: string): PromptGroupRow[] {
  return (project
    ? sql(`${PROMPT_GROUP} WHERE project = ? ORDER BY first_at DESC LIMIT ?`).all(project, limit)
    : sql(`${PROMPT_GROUP} ORDER BY first_at DESC LIMIT ?`).all(limit)) as unknown as PromptGroupRow[];
}

export function getPromptGroup(promptId: string): PromptGroupRow | undefined {
  return sql(`${PROMPT_GROUP} WHERE prompt_id = ?`).get(promptId) as unknown as PromptGroupRow | undefined;
}

// ---------- token totals ----------

export interface TokenTotals {
  calls: number;
  inputTokens: number;
  resultTokens: number;
  savedTokens: number;
}

const TOKEN_TOTALS = `
  SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens), 0) AS inputTokens, COALESCE(SUM(result_tokens), 0) AS resultTokens,
         COALESCE(SUM(result_tokens - result_tokens_after), 0) AS savedTokens
    FROM tool_calls WHERE result_tokens IS NOT NULL`;

export function tokenTotals(project?: string): TokenTotals {
  return (project ? sql(`${TOKEN_TOTALS} AND project = ?`).get(project) : sql(TOKEN_TOTALS).get()) as unknown as TokenTotals;
}

/** Calls the rules denied, blocked (enforce) or only logged (monitor). */
export function countDeniedCalls(): number {
  return (sql(`SELECT COUNT(*) AS n FROM tool_calls WHERE decision IN ('denied', 'would_deny')`).get() as { n: number }).n;
}
