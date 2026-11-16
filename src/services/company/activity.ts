import { sql } from "../../storage/database";
import { getSetting, setSetting } from "../../storage/tables/settings";
import { post } from "./api";
import type { CompanyConfig } from "./sync";

// Tool activity upload: metadata of logged tool calls (never the tool input or result) goes to the
// company server, limited to the decisions the company opted into. Runs inside the throttled sync.

const CURSOR = "company:activity_cursor";
const BATCH = 500; // ponytail: one batch per sync tick, a backlog drains over later ticks; loop if that is too slow

const APPROVED = ["allowed", "observed"];
const DENIED = ["denied", "would_deny"];

interface ActivityRow {
  id: number;
  tool_use_id: string;
  session_id: string | null;
  agent: string;
  tool_name: string;
  decision: string;
  rule: string | null;
  occurred_at: string | null;
}

const maxCallId = () => (sql(`SELECT COALESCE(MAX(id), 0) AS id FROM tool_calls`).get() as { id: number }).id;

/** Starts uploads from now: calls logged before the login are never sent. */
export function resetActivityCursor(): void {
  setSetting(CURSOR, String(maxCallId()));
}

/**
 * Uploads the next batch of calls after the cursor. Must run before the rules sync replaces the local
 * rules, or matched rules of not-yet-uploaded calls are gone (sent as null).
 */
export async function uploadActivity(): Promise<number> {
  const config = getSetting("company:config");
  const cursor = getSetting(CURSOR);
  // No cursor: logged in before this feature existed. Start from now, like a fresh login.
  if (cursor === undefined) {
    resetActivityCursor();
    return 0;
  }
  if (!config) return 0;
  const cfg = JSON.parse(config) as CompanyConfig;
  const decisions = [...(cfg.sync_approved_activities ? APPROVED : []), ...(cfg.sync_denied_activities ? DENIED : [])];

  const rows = sql(
    `SELECT c.id, c.tool_use_id, c.session_id, c.integration AS agent, c.tool_name, c.decision, r.rule,
            COALESCE(c.started_at, c.completed_at) AS occurred_at
       FROM tool_calls c LEFT JOIN tool_rules r ON r.id = c.rule_id
      WHERE c.id > ? ORDER BY c.id LIMIT ?`
  ).all(Number(cursor), BATCH) as unknown as ActivityRow[];
  if (!rows.length) return 0;

  const events = rows
    .filter((r) => decisions.includes(r.decision))
    .map(({ id: _id, occurred_at, ...r }) => ({ ...r, occurred_at: occurred_at ?? new Date().toISOString() }));
  if (events.length) await post("/client/activity", { events }, true);
  // Skipped (not opted-in) calls move the cursor too: they are never sent, even if the company opts in later.
  setSetting(CURSOR, String(rows[rows.length - 1].id));
  return events.length;
}
