import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";

// Point the gateway at a throwaway database before any gateway module is loaded.
const dir = mkdtempSync(join(tmpdir(), "apichap-gateway-test-"));
process.env.APICHAP_GATEWAY_DIR = dir;

type ServerModule = typeof import("../src/dashboard/server");
type StoreModule = typeof import("../src/services/settings") &
  typeof import("../src/services/tool-security/rules") &
  typeof import("../src/services/tool-security/requests");
type DbModule = typeof import("../src/storage/database") & typeof import("../src/storage/tables/tool-calls");

let store: StoreModule;
let db: DbModule;
let dashboard: Awaited<ReturnType<ServerModule["startDashboard"]>>;
let base: string;
const TOKEN = "test-token";

before(async () => {
  const server: ServerModule = await import("../src/dashboard/server");
  store = {
    ...(await import("../src/services/settings")),
    ...(await import("../src/services/tool-security/rules")),
    ...(await import("../src/services/tool-security/requests")),
  };
  db = { ...(await import("../src/storage/database")), ...(await import("../src/storage/tables/tool-calls")) };
  dashboard = await server.startDashboard({ port: 0, token: TOKEN, pollMs: 50 });
  base = `http://127.0.0.1:${dashboard.port}`;
});

after(async () => {
  await dashboard.close();
  db.closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const api = (method: string, path: string, body?: unknown) =>
  fetch(base + path, {
    method,
    headers: { "X-Gateway-Token": TOKEN, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

function fileUnlisted(command: string): number {
  const verdict = store.evaluateCall("Bash", { command }, dir);
  assert.ok(verdict.decision === "deny" && verdict.reason === "unlisted");
  return store.fileRequest({ toolName: "Bash", toolInput: { command }, cwd: dir, sessionId: "s1", verdict });
}

test("serves the page", async () => {
  const res = await fetch(base + "/");
  assert.equal(res.status, 200);
  assert.match(await res.text(), /apichap AI Coding Gateway/);
});

test("serves the page's stylesheet and modules with a strict CSP", async () => {
  const page = await fetch(base + "/");
  const csp = page.headers.get("content-security-policy") ?? "";
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  const html = await page.text();
  assert.doesNotMatch(html, /<script>|style="/); // no inline code or styles
  assert.match(html, /<script type="module" src="\/js\/main\.js">/);

  const css = await fetch(base + "/styles.css");
  assert.equal(css.headers.get("content-type"), "text/css; charset=utf-8");
  for (const mod of ["main", "core", "format", "activity", "approvals", "rules", "savings"]) {
    const res = await fetch(`${base}/js/${mod}.js`);
    assert.equal(res.status, 200, mod);
    assert.equal(res.headers.get("content-type"), "text/javascript; charset=utf-8");
  }
  for (const bad of ["/js/../server.ts", "/js/%2e%2e/server.ts", "/server.ts", "/js/missing.js", "/public/index.html"]) {
    assert.equal((await fetch(base + bad)).status, 404, bad);
  }
});

test("serves brand assets without a token, nothing else", async () => {
  const logo = await fetch(base + "/assets/apichap-logo.png");
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get("content-type"), "image/png");
  assert.equal((await fetch(base + "/assets/missing.png")).status, 404);
  assert.equal((await fetch(base + "/assets/..%2Fserver.ts")).status, 404);
});

test("API requires the token", async () => {
  assert.equal((await fetch(base + "/api/rules")).status, 401);
  assert.equal((await fetch(base + "/api/rules", { headers: { "X-Gateway-Token": "wrong" } })).status, 401);
  assert.equal((await api("GET", "/api/rules")).status, 200);
});

test("rejects foreign Host headers (DNS rebinding)", async () => {
  const status = await new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: dashboard.port,
        path: "/api/rules",
        headers: { Host: "evil.example:80", "X-Gateway-Token": TOKEN },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      }
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(status, 403);
});

test("rejects cross-origin requests", async () => {
  const res = await fetch(base + "/api/rules", { headers: { "X-Gateway-Token": TOKEN, Origin: "https://evil.example" } });
  assert.equal(res.status, 403);
});

test("approve broad adds a rule and closes covered requests", async () => {
  const up = fileUnlisted("docker compose up -d");
  const down = fileUnlisted("docker compose down");

  const res = await api("POST", `/api/requests/${up}/approve`, { mode: "broad" });
  assert.equal(res.status, 200);
  const result = (await res.json()) as { rules: string[]; autoClosed: number[] };
  assert.deepEqual(result.rules, ["Bash(docker compose *)"]);
  assert.deepEqual(result.autoClosed, [down]);

  const pending = (await (await api("GET", "/api/requests")).json()) as unknown[];
  assert.equal(pending.length, 0);
  const verdict = (await (await api("POST", "/api/rules/test", { call: "Bash(docker compose logs)" })).json()) as {
    decision: string;
  };
  assert.equal(verdict.decision, "allow");
});

test("rule CRUD and validation", async () => {
  const bad = await api("POST", "/api/rules", { effect: "allow", rule: "Bash(unclosed" });
  assert.equal(bad.status, 400);

  const created = await api("POST", "/api/rules", { effect: "deny", rule: "Bash(* > *)", note: "no redirection" });
  assert.equal(created.status, 201);
  const { id } = (await created.json()) as { id: number };
  assert.equal((await api("PATCH", `/api/rules/${id}`, { enabled: false })).status, 200);
  assert.equal((await api("DELETE", `/api/rules/${id}`)).status, 200);
  assert.equal((await api("DELETE", `/api/rules/${id}`)).status, 404);
});

test("live stream pushes new tool calls", async () => {
  const received = new Promise<string>((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port: dashboard.port, path: `/api/stream?token=${TOKEN}` }, (res) => {
      let buffer = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buffer += chunk;
        if (buffer.includes("event: calls")) {
          req.destroy();
          resolve(buffer);
        }
      });
    });
    req.on("error", (err) => (err.message.includes("aborted") || err.message.includes("socket hang up") ? null : reject(err)));
    req.end();
    setTimeout(() => reject(new Error("no calls event within 3s")), 3000);
  });

  await new Promise((r) => setTimeout(r, 150));
  db.insertCall({
    toolUseId: "tu-live",
    sessionId: "s1",
    project: dir,
    toolName: "Bash",
    toolInput: { command: "git status" },
    decision: "allowed",
  });
  assert.match(await received, /git status/);
});

test("managed policy makes rules read-only in the API", async () => {
  store.setPolicySource("managed");
  try {
    assert.equal((await api("POST", "/api/rules", { effect: "allow", rule: "Bash(x)" })).status, 403);
    assert.equal((await api("PUT", "/api/mode", { mode: "off" })).status, 403);
    const id = fileUnlisted("terraform apply");
    assert.equal((await api("POST", `/api/requests/${id}/approve`, { mode: "exact" })).status, 403);
    assert.equal((await api("GET", "/api/rules")).status, 200);
  } finally {
    store.setPolicySource("local");
  }
});

test("reduction options can be listed and switched, and are locked when managed", async () => {
  const data = (await (await api("GET", "/api/reduction")).json()) as {
    strategies: Array<{ id: string; state: string; states: string[] }>;
  };
  const paging = data.strategies.find((s) => s.id === "paging")!;
  assert.deepEqual(paging.states, ["on", "measure", "off"]);
  assert.deepEqual(data.strategies.find((s) => s.id === "grep-limit")!.states, ["on", "off"]);

  assert.equal((await api("PUT", "/api/reduction/paging", { state: "measure" })).status, 200);
  const after = (await (await api("GET", "/api/reduction")).json()) as { strategies: Array<{ id: string; state: string }> };
  assert.equal(after.strategies.find((s) => s.id === "paging")!.state, "measure");
  assert.equal((await api("PUT", "/api/reduction/grep-limit", { state: "measure" })).status, 400);
  assert.equal((await api("PUT", "/api/reduction/nope", { state: "on" })).status, 400);

  store.setPolicySource("managed");
  try {
    assert.equal((await api("PUT", "/api/reduction/paging", { state: "on" })).status, 403);
  } finally {
    store.setPolicySource("local");
  }
});

test("tool calls are grouped by prompt with token totals", async () => {
  const base = { sessionId: "s2", project: dir, toolName: "Bash", promptId: "prompt-a", decision: "allowed" as const };
  db.insertCall({ ...base, toolUseId: "g1", toolInput: { command: "ls" } });
  db.completeCall({
    ...base,
    toolUseId: "g1",
    toolInput: { command: "ls" },
    toolResult: { stdout: "a" },
    resultTokens: 100,
    resultTokensAfter: 40,
    inputTokens: 5,
  });
  db.insertCall({ ...base, toolUseId: "g2", toolInput: { command: "pwd" } });
  db.completeCall({
    ...base,
    toolUseId: "g2",
    toolInput: { command: "pwd" },
    toolResult: { stdout: "b" },
    resultTokens: 50,
    resultTokensAfter: 50,
    inputTokens: 3,
  });

  const prompts = (await (await api("GET", "/api/prompts")).json()) as Array<{
    promptId: string;
    callCount: number;
    tokens: { input: number; result: number; saved: number };
    calls: Array<{ tokens: { result: number; resultAfter: number } }>;
  }>;
  const a = prompts.find((p) => p.promptId === "prompt-a")!;
  assert.equal(a.callCount, 2);
  assert.deepEqual({ ...a.tokens, potential: undefined }, { input: 8, result: 150, saved: 60, potential: undefined });
  assert.equal(a.calls[0].tokens.resultAfter, 40);
  assert.equal((await api("GET", "/api/prompts/prompt-a")).status, 200);
  assert.equal((await api("GET", "/api/prompts/unknown")).status, 404);
});

test("projects are listed and calls, prompts and tokens can be filtered by project", async () => {
  const other = join(dir, "other-project");
  const add = (id: string, project: string, promptId: string, tokens: number) => {
    const base = { sessionId: "s3", project, toolName: "Bash", promptId, decision: "allowed" as const };
    db.insertCall({ ...base, toolUseId: id, toolInput: { command: id } });
    db.completeCall({
      ...base,
      toolUseId: id,
      toolInput: { command: id },
      toolResult: { stdout: "" },
      resultTokens: tokens,
      resultTokensAfter: tokens,
    });
  };
  add("pf1", other, "prompt-other", 700);
  add("pf2", other, "prompt-other", 300);

  const projects = (await (await api("GET", "/api/projects")).json()) as Array<{ project: string; calls: number }>;
  assert.equal(projects.find((p) => p.project === other)?.calls, 2);
  assert.ok(projects.some((p) => p.project === dir));

  const q = `project=${encodeURIComponent(other)}`;
  const calls = (await (await api("GET", `/api/calls?${q}`)).json()) as Array<{ project: string }>;
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.project === other));

  const prompts = (await (await api("GET", `/api/prompts?${q}`)).json()) as Array<{ promptId: string }>;
  assert.deepEqual(
    prompts.map((p) => p.promptId),
    ["prompt-other"]
  );

  const tokens = (await (await api("GET", `/api/tokens?${q}`)).json()) as { calls: number; resultTokens: number };
  assert.deepEqual({ calls: tokens.calls, resultTokens: tokens.resultTokens }, { calls: 2, resultTokens: 1000 });
});

test("each call carries the reason for its decision", async () => {
  const denyRule = store.listRules().find((r) => r.effect === "deny" && r.rule === "Shell(rm *)")!;
  const requestId = fileUnlisted("docker run nginx");
  const base = { sessionId: "s4", project: dir, toolName: "Bash", promptId: "prompt-reason" };
  db.insertCall({ ...base, toolUseId: "r1", toolInput: { command: "rm -rf x" }, decision: "denied", ruleId: denyRule.id });
  db.insertCall({ ...base, toolUseId: "r2", toolInput: { command: "docker run nginx" }, decision: "would_deny", requestId });

  const calls = (await (await api("GET", `/api/calls?project=${encodeURIComponent(dir)}`)).json()) as Array<{
    toolUseId: string;
    reason: { kind: string; rule?: string; note?: string; effect?: string; requestId?: number; requestStatus?: string } | null;
  }>;
  const byRule = calls.find((c) => c.toolUseId === "r1")!.reason!;
  assert.deepEqual([byRule.kind, byRule.effect, byRule.rule, byRule.note], ["rule", "deny", "Shell(rm *)", denyRule.note]);
  const unlisted = calls.find((c) => c.toolUseId === "r2")!.reason!;
  assert.deepEqual([unlisted.kind, unlisted.requestId, unlisted.requestStatus], ["unlisted", requestId, "pending"]);
});

test("rules can be exported, imported (replace or merge) and reset to defaults", async () => {
  const exported = (await (await api("GET", "/api/rules/export")).json()) as { allow: unknown[]; deny: unknown[] };
  assert.ok(exported.allow.length > 10 && exported.deny.length > 10);

  const custom = {
    name: "Team rules",
    allow: ["Read", { rule: "Shell(git *)", note: "git" }],
    deny: [{ rule: "Shell(rm *)", note: "no deleting" }],
  };
  const replaced = (await (await api("POST", "/api/rules/import", { file: custom, mode: "replace" })).json()) as {
    total: number;
    removed: number;
  };
  assert.equal(replaced.total, 3);
  assert.ok(replaced.removed > 10);

  const merged = (await (
    await api("POST", "/api/rules/import", { file: { allow: ["Read", "Grep"] }, mode: "merge" })
  ).json()) as { added: number; total: number };
  assert.deepEqual([merged.added, merged.total], [1, 4]);

  // Invalid files change nothing and list every problem.
  const bad = await api("POST", "/api/rules/import", { file: { allow: ["Shell(unclosed", 42] }, mode: "replace" });
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as { error: string }).error, /2 problem/);
  assert.equal(((await (await api("GET", "/api/rules")).json()) as unknown[]).length, 4);

  const defaults = (await (await api("GET", "/api/rules/defaults")).json()) as { version: number; rules: number };
  const reset = (await (await api("POST", "/api/rules/reset", { mode: "replace" })).json()) as { total: number };
  assert.equal(reset.total, defaults.rules);
  assert.equal(
    ((await (await api("GET", "/api/rules/defaults")).json()) as { importedVersion: number }).importedVersion,
    defaults.version
  );

  store.setPolicySource("managed");
  try {
    assert.equal((await api("POST", "/api/rules/import", { file: custom, mode: "replace" })).status, 403);
    assert.equal((await api("POST", "/api/rules/reset", { mode: "replace" })).status, 403);
  } finally {
    store.setPolicySource("local");
  }
});

test("export writes every rule as an object", async () => {
  const exported = (await (await api("GET", "/api/rules/export")).json()) as { allow: unknown[]; deny: unknown[] };
  assert.ok([...exported.allow, ...exported.deny].every((e) => typeof e === "object" && e !== null && "rule" in e));
});
