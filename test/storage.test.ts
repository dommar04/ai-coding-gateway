import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the gateway at a throwaway database before any storage module is loaded.
const dir = mkdtempSync(join(tmpdir(), "apichap-storage-"));
process.env.APICHAP_GATEWAY_DIR = dir;

type Db = typeof import("../src/storage/database");
let db: Db;
let migrations: typeof import("../src/storage/migrations");
let rules: typeof import("../src/storage/tables/tool-rules");
let requests: typeof import("../src/storage/tables/approval-requests");
let settings: typeof import("../src/storage/tables/settings");
let calls: typeof import("../src/storage/tables/tool-calls");

before(async () => {
  db = await import("../src/storage/database");
  migrations = await import("../src/storage/migrations");
  rules = await import("../src/storage/tables/tool-rules");
  requests = await import("../src/storage/tables/approval-requests");
  settings = await import("../src/storage/tables/settings");
  calls = await import("../src/storage/tables/tool-calls");
});

after(() => {
  db.closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test("a fresh database runs all migrations once and starts with the default rules in monitor mode", () => {
  const version = (db.getDb().prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  assert.equal(version, migrations.MIGRATIONS.length);
  assert.ok(rules.countRules() > 100);
  assert.equal(settings.getSetting("mode"), "monitor");
  assert.ok(Number(settings.getSetting("defaults_version")) > 0);

  // Reopening does not run anything again.
  const before = rules.countRules();
  db.closeDb();
  db.getDb();
  assert.equal(rules.countRules(), before);
});

test("tables are STRICT and enforce their constraints", () => {
  const strict = db.getDb().prepare(`SELECT name FROM pragma_table_list WHERE schema = 'main' AND strict = 1`).all() as Array<{
    name: string;
  }>;
  for (const t of ["tool_calls", "tool_rules", "approval_requests", "settings", "reduction_stats", "read_cache"]) {
    assert.ok(
      strict.some((s) => s.name === t),
      `${t} is STRICT`
    );
  }
  assert.throws(
    () => db.getDb().prepare(`INSERT INTO tool_rules (effect, rule, source, created_at) VALUES ('maybe', 'X', 's', 'now')`).run(),
    /CHECK/
  );
  // STRICT: text in an INTEGER column is rejected (SQLite only converts when nothing is lost).
  assert.throws(
    () =>
      db
        .getDb()
        .prepare(
          `INSERT INTO tool_calls (tool_use_id, tool_name, decision, input_tokens) VALUES ('x', 'Bash', 'allowed', 'lots')`
        )
        .run(),
    /cannot store/i
  );
});

test("rules: duplicates are rejected, approving re-enables an existing rule", () => {
  const rule = { effect: "allow" as const, rule: "Shell(docker compose *)", note: null, source: "manual", createdBy: "test" };
  const id = rules.insertRule(rule);
  assert.ok(id);
  assert.equal(rules.insertRule(rule), null);
  rules.setRuleEnabled(id, false);
  assert.equal(rules.upsertEnabledRule(rule), id);
  assert.equal(rules.getRule(id)?.enabled, 1);
});

test("approval requests: one pending request per call pattern, repeats count up", () => {
  const request = {
    requestKey: "Bash\ncurl example.com",
    toolName: "Bash",
    subject: "curl example.com",
    uncovered: ["curl example.com"],
    suggestedExact: ["Bash(curl example.com)"],
    suggestedBroad: ["Bash(curl *)"],
    toolInput: { command: "curl example.com" },
    sessionId: "s1",
    project: dir,
  };
  const first = requests.upsertPendingRequest(request);
  assert.equal(requests.upsertPendingRequest(request), first);
  assert.equal(requests.getRequest(first)?.hit_count, 2);

  // Once decided, the same pattern opens a new request.
  requests.markRequestRejected(first, "test");
  assert.notEqual(requests.upsertPendingRequest(request), first);
});

test("transactions roll back completely and can be nested", () => {
  const before = rules.countRules();
  assert.throws(() =>
    db.transaction(() => {
      rules.insertRule({ effect: "deny", rule: "Shell(temp-1 *)", note: null, source: "t", createdBy: "t" });
      db.transaction(() =>
        rules.insertRule({ effect: "deny", rule: "Shell(temp-2 *)", note: null, source: "t", createdBy: "t" })
      );
      throw new Error("abort");
    })
  );
  assert.equal(rules.countRules(), before);
});

test("tool calls: start and completion end up in one row; unknown completions are logged as observed", () => {
  const base = { sessionId: "s", project: dir, toolName: "Bash", toolInput: { command: "ls" } };
  calls.insertCall({ ...base, toolUseId: "c1", decision: "allowed" });
  calls.completeCall({ ...base, toolUseId: "c1", toolResult: { stdout: "a" }, resultTokens: 10, resultTokensAfter: 4 });
  const row = calls.listRecentCalls(5).find((r) => r.tool_use_id === "c1")!;
  assert.equal(row.decision, "allowed");
  assert.ok(row.started_at && row.completed_at);
  assert.equal(row.result_tokens_after, 4);

  calls.completeCall({ ...base, toolUseId: "c2", toolResult: { stdout: "b" } });
  assert.equal(calls.listRecentCalls(5).find((r) => r.tool_use_id === "c2")?.decision, "observed");
});
