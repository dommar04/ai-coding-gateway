import { sql } from "../database";

// Table read_cache: which file content an agent session has already read (for "skip unchanged re-reads").

export interface CachedRead {
  hash: string;
  readAt: string;
  toolUseId: string | null;
}

export function getCachedRead(sessionKey: string, readKey: string): CachedRead | null {
  const row = sql(`SELECT hash, read_at, tool_use_id FROM read_cache WHERE session_key = ? AND read_key = ?`).get(
    sessionKey,
    readKey
  ) as { hash: string; read_at: string; tool_use_id: string | null } | undefined;
  return row ? { hash: row.hash, readAt: row.read_at, toolUseId: row.tool_use_id } : null;
}

export function putCachedRead(sessionKey: string, readKey: string, hash: string, toolUseId: string): void {
  sql(
    `INSERT INTO read_cache (session_key, read_key, hash, tool_use_id, read_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (session_key, read_key) DO UPDATE SET hash = excluded.hash, tool_use_id = excluded.tool_use_id, read_at = excluded.read_at`
  ).run(sessionKey, readKey, hash, toolUseId, new Date().toISOString());
}

/** Forgets everything a session (and its sub-agents) has read. */
export function deleteSessionReads(sessionId: string): void {
  sql(`DELETE FROM read_cache WHERE session_key = ? OR session_key LIKE ?`).run(sessionId, `${sessionId}:%`);
}
