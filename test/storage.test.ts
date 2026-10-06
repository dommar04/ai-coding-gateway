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
let groups: typeof import("../src/storage/tables/rule-groups");
let settings: typeof import("../src/storage/tables/settings");
let calls: typeof import("../src/storage/tables/tool-calls");

before(async () => {
  db = await import("../src/storage/database");
  migrations = await import("../src/storage/migrations");
  rules = await import("../src/storage/tables/tool-rules");
  groups = await import("../src/storage/tables/rule-groups");
  settings = await import("../src/storage/tables/settings");
  calls = await import("../src/storage/tables/tool-calls");
});

after(() => {
  db.closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test("a fresh database runs all migrations once and starts with the default rules in enforce mode", () => {
  const version = (db.getDb().prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  assert.equal(version, migrations.MIGRATIONS.length);
  assert.ok(rules.countRules() > 100);
  assert.equal(settings.getSetting("mode"), "enforce");
  assert.ok(Number(settings.getSetting("defaults_version")) > 0);
  // Every default rule sits in its group.
  assert.ok(groups.countGroups() > 10);
  assert.ok(rules.listRules().every((r) => r.group_id !== null && r.group_title));

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
  for (const t of ["tool_calls", "tool_rules", "rule_groups", "settings", "reduction_stats", "read_cache"]) {
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

const newGroup = (key: string) => groups.insertGroup({ key, title: key, description: null, source: "t", createdBy: "t" });

test("rules: duplicates are rejected, approving re-enables an existing rule", () => {
  const groupId = newGroup("test-dupes");
  const rule = {
    effect: "allow" as const,
    rule: "Shell(docker compose *)",
    note: null,
    source: "manual",
    createdBy: "test",
    groupId,
  };
  const id = rules.insertRule(rule);
  assert.ok(id);
  assert.equal(rules.insertRule(rule), null);
  rules.setRuleEnabled(id, false);
  assert.equal(rules.upsertEnabledRule(rule), id);
  assert.equal(rules.getRule(id)?.enabled, 1);
});

test("rule groups: a switched-off group switches its rules off, deleting it deletes them", () => {
  const off = newGroup("test-off");
  const on = newGroup("test-on");
  const rule = { effect: "allow" as const, rule: "Shell(podman *)", note: null, source: "manual", createdBy: "t", groupId: off };
  const id = rules.insertRule(rule)!;
  const active = () => rules.listRules({ enabledOnly: true }).some((r) => r.id === id);
  assert.ok(active());
  groups.updateGroup(off, { enabled: false });
  assert.ok(!active());

  // Approving a rule that sits in a switched-off group moves it to the approving group.
  assert.equal(rules.upsertEnabledRule({ ...rule, groupId: on }), id);
  assert.equal(rules.getRule(id)?.group_id, on);
  assert.ok(active());

  groups.deleteGroup(on);
  assert.equal(rules.getRule(id), undefined);
});

test("migration 003 puts existing rules into groups without adding or removing any", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const mem = new DatabaseSync(":memory:");
  mem.exec("PRAGMA foreign_keys = ON");
  migrations.MIGRATIONS[0].up(mem);
  migrations.MIGRATIONS[1].up(mem);
  const add = mem.prepare(`INSERT INTO tool_rules (effect, rule, note, source, created_at) VALUES (?, ?, NULL, ?, 'now')`);
  add.run("allow", "Read", "default"); // in an earlier default version only
  add.run("allow", "Shell(docker *)", "approved");
  add.run("deny", "Shell(curl *)", "dashboard");
  const count = () => (mem.prepare(`SELECT COUNT(*) AS n FROM tool_rules`).get() as { n: number }).n;
  const before = count();

  migrations.MIGRATIONS[2].up(mem);
  assert.equal(count(), before);
  const groupOf = (rule: string) =>
    (
      mem.prepare(`SELECT g.key FROM tool_rules r JOIN rule_groups g ON g.id = r.group_id WHERE r.rule = ?`).get(rule) as {
        key: string;
      }
    ).key;
  assert.equal(groupOf("Shell(rm *)"), "no-deleting-files");
  assert.equal(groupOf("Read"), "previous-defaults");
  assert.equal(groupOf("Shell(docker *)"), "approved");
  assert.equal(groupOf("Shell(curl *)"), "custom");
  assert.equal((mem.prepare(`SELECT COUNT(*) AS n FROM tool_rules WHERE group_id IS NULL`).get() as { n: number }).n, 0);
  mem.close();
});

test("approval requests are gone: no table, and the call log has no link to them", () => {
  const table = db.getDb().prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'approval_requests'`).get();
  assert.equal(table, undefined);
  const columns = db.getDb().prepare(`SELECT name FROM pragma_table_info('tool_calls')`).all() as Array<{ name: string }>;
  assert.ok(columns.length > 0);
  assert.ok(!columns.some((c) => c.name === "request_id"));
});

test("measure mode is gone: no potential or measured token columns", () => {
  const columns = (table: string) =>
    (db.getDb().prepare(`SELECT name FROM pragma_table_info(?)`).all(table) as Array<{ name: string }>).map((c) => c.name);
  assert.ok(columns("tool_calls").includes("result_tokens_after"));
  assert.ok(!columns("tool_calls").includes("saved_potential"));
  assert.deepEqual(columns("reduction_stats").sort(), ["calls", "saved_tokens", "strategy_id"]);
});

test("transactions roll back completely and can be nested", () => {
  const before = rules.countRules();
  const groupId = newGroup("test-tx");
  assert.throws(() =>
    db.transaction(() => {
      rules.insertRule({ effect: "deny", rule: "Shell(temp-1 *)", note: null, source: "t", createdBy: "t", groupId });
      db.transaction(() =>
        rules.insertRule({ effect: "deny", rule: "Shell(temp-2 *)", note: null, source: "t", createdBy: "t", groupId })
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
