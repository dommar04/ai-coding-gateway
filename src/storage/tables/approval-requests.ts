import { sql } from "../database";

// Table approval_requests: unlisted tool calls waiting for an admin. At most one pending request
// per request_key (enforced by a partial unique index); repeats bump hit_count.

export type RequestStatus = "pending" | "approved" | "rejected";

export interface RequestRow {
  id: number;
  request_key: string;
  tool_name: string;
  subject: string | null;
  uncovered: string | null;
  suggested_exact: string | null;
  suggested_broad: string | null;
  tool_input: string | null;
  session_id: string | null;
  project: string | null;
  status: RequestStatus;
  hit_count: number;
  first_seen: string;
  last_seen: string;
  decided_by: string | null;
  decided_at: string | null;
  rule_ids: string | null;
}

export interface NewRequest {
  requestKey: string;
  toolName: string;
  subject: string | null;
  uncovered: string[];
  suggestedExact: string[];
  suggestedBroad: string[];
  toolInput: unknown;
  sessionId: string;
  project: string;
}

/** Files a pending request, or bumps the hit count of the pending one with the same key. Returns its id. */
export function upsertPendingRequest(r: NewRequest): number {
  const now = new Date().toISOString();
  const row = sql(
    `INSERT INTO approval_requests (request_key, tool_name, subject, uncovered, suggested_exact, suggested_broad, tool_input,
                                    session_id, project, first_seen, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (request_key) WHERE status = 'pending'
     DO UPDATE SET hit_count = hit_count + 1, last_seen = excluded.last_seen
     RETURNING id`
  ).get(
    r.requestKey,
    r.toolName,
    r.subject,
    JSON.stringify(r.uncovered),
    JSON.stringify(r.suggestedExact),
    JSON.stringify(r.suggestedBroad),
    JSON.stringify(r.toolInput ?? null),
    r.sessionId,
    r.project,
    now,
    now
  ) as { id: number };
  return row.id;
}

export function listRequests(status: RequestStatus | "all" = "pending"): RequestRow[] {
  return (status === "all"
    ? sql(`SELECT * FROM approval_requests ORDER BY id DESC`).all()
    : sql(`SELECT * FROM approval_requests WHERE status = ? ORDER BY id DESC`).all(status)) as unknown as RequestRow[];
}

export function getRequest(id: number): RequestRow | undefined {
  return sql(`SELECT * FROM approval_requests WHERE id = ?`).get(id) as unknown as RequestRow | undefined;
}

export function countPendingRequests(): number {
  return (sql(`SELECT COUNT(*) AS n FROM approval_requests WHERE status = 'pending'`).get() as { n: number }).n;
}

export function markRequestApproved(id: number, decidedBy: string, ruleIds: number[]): void {
  sql(`UPDATE approval_requests SET status = 'approved', decided_by = ?, decided_at = ?, rule_ids = ? WHERE id = ?`).run(
    decidedBy,
    new Date().toISOString(),
    JSON.stringify(ruleIds),
    id
  );
}

export function markRequestRejected(id: number, decidedBy: string): void {
  sql(`UPDATE approval_requests SET status = 'rejected', decided_by = ?, decided_at = ? WHERE id = ?`).run(
    decidedBy,
    new Date().toISOString(),
    id
  );
}
