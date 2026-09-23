import type { Migration } from "./types";

// STRICT tables: SQLite enforces the declared column types. JSON is stored as TEXT, timestamps as
// ISO-8601 TEXT (UTC). rule_id / request_id in tool_calls have no foreign key on purpose: the call
// log keeps the id even after a rule or request is deleted.

export const initialSchema: Migration = {
  id: "001-initial-schema",
  up(db) {
    db.exec(`
      CREATE TABLE tool_calls (
        id                  INTEGER PRIMARY KEY,
        tool_use_id         TEXT NOT NULL,
        session_id          TEXT,
        agent_id            TEXT,
        prompt_id           TEXT,
        transcript_path     TEXT,
        project             TEXT,
        tool_name           TEXT NOT NULL,
        tool_input          TEXT,
        decision            TEXT NOT NULL CHECK (decision IN ('allowed', 'denied', 'would_deny', 'observed')),
        rule_id             INTEGER,
        request_id          INTEGER,
        input_rewrite       TEXT,
        input_tokens        INTEGER,
        started_at          TEXT,
        completed_at        TEXT,
        duration_ms         INTEGER,
        tool_result         TEXT,
        reduced_result      TEXT,
        result_tokens       INTEGER,
        result_tokens_after INTEGER,
        saved_potential     INTEGER,
        reduction           TEXT
      ) STRICT;
      CREATE INDEX idx_tool_calls_tool_use_id  ON tool_calls (tool_use_id);
      CREATE INDEX idx_tool_calls_prompt_id    ON tool_calls (prompt_id);
      CREATE INDEX idx_tool_calls_project      ON tool_calls (project);
      CREATE INDEX idx_tool_calls_completed_at ON tool_calls (completed_at);

      CREATE TABLE tool_rules (
        id         INTEGER PRIMARY KEY,
        effect     TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
        rule       TEXT NOT NULL,
        note       TEXT,
        enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        source     TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT,
        UNIQUE (effect, rule)
      ) STRICT;

      CREATE TABLE approval_requests (
        id              INTEGER PRIMARY KEY,
        request_key     TEXT NOT NULL,
        tool_name       TEXT NOT NULL,
        subject         TEXT,
        uncovered       TEXT,
        suggested_exact TEXT,
        suggested_broad TEXT,
        tool_input      TEXT,
        session_id      TEXT,
        project         TEXT,
        status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        hit_count       INTEGER NOT NULL DEFAULT 1,
        first_seen      TEXT NOT NULL,
        last_seen       TEXT NOT NULL,
        decided_by      TEXT,
        decided_at      TEXT,
        rule_ids        TEXT
      ) STRICT;
      -- At most one pending request per call pattern; repeats bump hit_count.
      CREATE UNIQUE INDEX ux_approval_requests_pending ON approval_requests (request_key) WHERE status = 'pending';
      CREATE INDEX idx_approval_requests_status ON approval_requests (status);

      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;

      CREATE TABLE reduction_stats (
        strategy_id     TEXT PRIMARY KEY,
        calls           INTEGER NOT NULL DEFAULT 0,
        saved_tokens    INTEGER NOT NULL DEFAULT 0,
        measured_tokens INTEGER NOT NULL DEFAULT 0
      ) STRICT;

      CREATE TABLE read_cache (
        session_key TEXT NOT NULL,
        read_key    TEXT NOT NULL,
        hash        TEXT NOT NULL,
        tool_use_id TEXT,
        read_at     TEXT NOT NULL,
        PRIMARY KEY (session_key, read_key)
      ) STRICT;
    `);
  },
};
