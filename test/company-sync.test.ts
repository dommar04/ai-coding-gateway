import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the gateway at a throwaway database before any gateway module is loaded.
const dir = mkdtempSync(join(tmpdir(), "apichap-gateway-test-"));
process.env.APICHAP_GATEWAY_DIR = dir;
process.env.APICHAP_GATEWAY_SERVER = "https://company.test/";

type Modules = typeof import("../src/services/company/api") &
  typeof import("../src/services/company/sync") &
  typeof import("../src/services/settings") &
  typeof import("../src/storage/tables/settings") &
  typeof import("../src/storage/tables/tool-rules") &
  typeof import("../src/storage/database");

let m: Modules;
const realFetch = globalThis.fetch;

before(async () => {
  m = {
    ...(await import("../src/services/company/api")),
    ...(await import("../src/services/company/sync")),
    ...(await import("../src/services/settings")),
    ...(await import("../src/storage/tables/settings")),
    ...(await import("../src/storage/tables/tool-rules")),
    ...(await import("../src/storage/database")),
  };
});

after(() => {
  globalThis.fetch = realFetch;
  m.closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const BUNDLE = {
  version: 3,
  config: { sync_approved_activities: false, sync_denied_activities: false, enable_traces: false, enable_github_pipeline: true },
  rule_groups: [
    {
      id: "6F1C2B4A-0000-4000-8000-000000000001",
      title: "Git",
      subtitle: null,
      rules: [
        { skill: "Bash", command: "git *", comment: "version control", allowed: true },
        { skill: "Bash", command: "rm -rf *", comment: null, allowed: false },
        { skill: "not a tool", command: "x", comment: null, allowed: true },
      ],
    },
  ],
};

type Call = { path: string; auth: string | null; body: Record<string, unknown> };

/** Stubs fetch; `respond` picks the status and body per path. Returns the recorded calls. */
function stubFetch(respond: (path: string, auth: string | null) => [number, unknown]): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input).replace("https://company.test", "");
    const auth = new Headers(init?.headers).get("authorization");
    calls.push({ path, auth, body: JSON.parse(String(init?.body)) });
    const [status, body] = respond(path, auth);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

const integration = { hooksInstalled: () => true } as unknown as import("../src/integrations").Integration;

test("sync replaces local rules with the company's, skips invalid rules and applies config", async () => {
  m.storeTokens({ access_token: "tok-1", refresh_token: "ref-1", expires_in: 3600 }, "dev@company.test");
  const calls = stubFetch(() => [200, BUNDLE]);

  const result = await m.syncNow(true);

  assert.deepEqual(result, { version: 3, rules: 2 });
  assert.deepEqual(
    calls.map((c) => [c.path, c.auth, c.body]),
    [["/client/sync", "Bearer tok-1", { hooks_installed: true }]]
  );
  const rules = m.listRules();
  assert.deepEqual(rules.map((r) => [r.effect, r.rule, r.note, r.source]).sort(), [
    ["allow", "Bash(git *)", "version control", "company"],
    ["deny", "Bash(rm -rf *)", null, "company"],
  ]);
  assert.equal(m.features().traces, false);
  assert.equal(m.features().pipelines, true);
  assert.equal(m.getSetting("company:version"), "3");
});

test("a group with a blank title still syncs", async () => {
  const { parseRuleFile } = await import("../src/services/tool-security/rule-files/rule-file");
  const groups = parseRuleFile(m.toRuleFile({ ...BUNDLE, rule_groups: [{ ...BUNDLE.rule_groups[0], title: "  " }] }));
  assert.equal(groups[0].title, "Company rules");
});

test("maybeSync does nothing within 5 minutes of the last sync", async () => {
  const calls = stubFetch(() => [200, BUNDLE]);
  await m.maybeSync(integration);
  assert.equal(calls.length, 0);
});

test("an expired access token is refreshed before the sync", async () => {
  m.storeTokens({ access_token: "old", refresh_token: "ref-1", expires_in: -1 });
  const calls = stubFetch((path) =>
    path === "/client/refresh" ? [200, { access_token: "new", refresh_token: "ref-2", expires_in: 3600 }] : [200, BUNDLE]
  );

  await m.syncNow(true);

  assert.deepEqual(
    calls.map((c) => [c.path, c.auth]),
    [
      ["/client/refresh", null],
      ["/client/sync", "Bearer new"],
    ]
  );
  assert.deepEqual(calls[0].body, { refresh_token: "ref-1" });
  assert.equal(m.getSetting("auth:refresh_token"), "ref-2");
});

test("dashboard: rule changes are blocked while managed, testing a call still works", async () => {
  globalThis.fetch = realFetch;
  const { startDashboard } = await import("../src/dashboard/server");
  const dashboard = await startDashboard({ port: 0, token: "t", pollMs: 1000 });
  const api = (method: string, path: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${dashboard.port}${path}`, {
      method,
      headers: { "X-Gateway-Token": "t", "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    const blocked = await api("POST", "/api/rules", { effect: "allow", rule: "Bash(ls)" });
    assert.equal(blocked.status, 403);
    assert.deepEqual(await blocked.json(), { error: "Rules are managed by your company." });
    assert.equal((await api("POST", "/api/rules/test", { call: "Bash(git status)" })).status, 200);
    assert.equal((await api("PUT", "/api/features", { feature: "traces", on: true })).status, 403);
    assert.equal((await api("PUT", "/api/features", { feature: "tokenSavings", on: false })).status, 200);
    const company = (await (await api("GET", "/api/company")).json()) as { managed: boolean; version: number };
    assert.equal(company.managed, true);
    assert.equal(company.version, 3);
  } finally {
    await dashboard.close();
  }
});

test("a failed login keeps the previous server", async () => {
  const { login } = await import("../src/services/company/session");
  m.setSetting("server_url", "https://old.test");
  stubFetch(() => [500, { detail: "down" }]);
  await assert.rejects(login("dev@company.test", "pw", "https://typo.test"), /Server error 500/);
  assert.equal(m.getSetting("server_url"), "https://old.test");
});

test("logout drops tokens and company state, keeps the server", async () => {
  const { logout, managed } = await import("../src/services/company/session");
  m.setSetting("server_url", "https://old.test");
  m.setSetting("auth:refresh_token", "r");
  m.setSetting("auth:email", "dev@company.test");
  m.setSetting("company:version", "3");
  assert.equal(managed(), true);
  logout();
  assert.equal(managed(), false);
  assert.equal(m.getSetting("auth:email"), undefined);
  assert.equal(m.getSetting("company:version"), undefined);
  assert.equal(m.getSetting("server_url"), "https://old.test");
});
