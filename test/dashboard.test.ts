import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";

// Point the gateway at a throwaway database before any gateway module is loaded.
const dir = mkdtempSync(join(tmpdir(), "apichap-gateway-test-"));
process.env.APICHAP_GATEWAY_DIR = dir;

type ServerModule = typeof import("../src/dashboard/server");
type StoreModule = typeof import("../src/services/settings") & typeof import("../src/services/tool-security/rules");
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

/** Logs a call that no allow rule covers (monitor mode) and returns its id. */
function logUnlisted(command: string, toolUseId: string): number {
  const verdict = store.evaluateCall("Bash", { command }, dir);
  assert.ok(verdict.decision === "deny" && verdict.reason === "unlisted");
  db.insertCall({ sessionId: "s1", project: dir, toolName: "Bash", toolUseId, toolInput: { command }, decision: "would_deny" });
  return db.lastCallId();
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
  for (const mod of ["main", "core", "format", "activity", "allow", "rules", "savings"]) {
    const res = await fetch(`${base}/js/${mod}.js`);
    assert.equal(res.status, 200, mod);
    assert.equal(res.headers.get("content-type"), "text/javascript; charset=utf-8");
  }
  for (const bad of ["/js/../server.ts", "/js/%2e%2e/server.ts", "/server.ts", "/js/missing.js", "/public/index.html"]) {
    assert.equal((await fetch(base + bad)).status, 404, bad);
  }
});

test("every element the page's scripts look up by id exists in index.html", () => {
  // A missing element makes $("#x").textContent throw, which stops the whole page from starting.
  const publicDir = join(__dirname, "..", "src", "dashboard", "public");
  const html = readFileSync(join(publicDir, "index.html"), "utf8");
  const defined = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const optional = new Set(["mode-hint"]); // looked up with a null check
  const missing: string[] = [];
  for (const file of readdirSync(join(publicDir, "js"))) {
    const js = readFileSync(join(publicDir, "js", file), "utf8");
    for (const [, id] of js.matchAll(/\$\$?\("#([\w-]+)/g)) {
      if (!defined.has(id) && !optional.has(id)) missing.push(`${file}: #${id}`);
    }
  }
  assert.deepEqual(missing, []);
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

test("a denied call can be allowed from the activity with the broad rule", async () => {
  const id = logUnlisted("docker compose up -d", "allow1");
  const options = async () =>
    (await (await api("GET", `/api/calls/${id}/allow`)).json()) as { state: string; exact?: string[]; broad?: string[] };
  const before = await options();
  assert.deepEqual(before, {
    state: "unlisted",
    uncovered: ["docker compose up -d"],
    exact: ["Bash(docker compose up -d)"],
    broad: ["Bash(docker compose *)"],
  });

  const res = await api("POST", `/api/calls/${id}/allow`, { mode: "broad" });
  assert.equal(res.status, 200);
  assert.deepEqual(((await res.json()) as { rules: string[] }).rules, ["Bash(docker compose *)"]);
  const added = store.listRules().find((r) => r.rule === "Bash(docker compose *)")!;
  assert.equal(store.listGroups().find((g) => g.id === added.group_id)?.key, "approved");

  // Now covered: nothing left to add, and similar calls are allowed too.
  assert.equal((await options()).state, "allowed");
  assert.equal((await api("POST", `/api/calls/${id}/allow`, { mode: "exact" })).status, 400);
  const verdict = (await (await api("POST", "/api/rules/test", { call: "Bash(docker compose logs)" })).json()) as {
    decision: string;
  };
  assert.equal(verdict.decision, "allow");
});

test("a call denied by a deny rule cannot be allowed with an allow rule", async () => {
  const denyRule = store.listRules().find((r) => r.effect === "deny" && r.rule === "Shell(rm *)")!;
  db.insertCall({
    sessionId: "s1",
    project: dir,
    toolName: "Bash",
    toolUseId: "allow2",
    toolInput: { command: "rm -rf build" },
    decision: "denied",
    ruleId: denyRule.id,
  });
  const id = db.lastCallId();
  const options = (await (await api("GET", `/api/calls/${id}/allow`)).json()) as { state: string; rule: { id: number } };
  assert.deepEqual([options.state, options.rule.id], ["denied-by-rule", denyRule.id]);
  assert.equal((await api("POST", `/api/calls/${id}/allow`, { mode: "custom", rule: "Bash(rm -rf build)" })).status, 400);
  assert.equal((await api("POST", `/api/calls/${id}/allow`, { mode: "sideways" })).status, 400);
  assert.equal((await api("GET", "/api/calls/999999/allow")).status, 404);
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
        // Wait for this test's call: calls logged by earlier tests may still be broadcast first.
        if (buffer.includes("event: calls") && buffer.includes("tu-live")) {
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

test("reduction options can be listed and switched", async () => {
  const data = (await (await api("GET", "/api/reduction")).json()) as {
    strategies: Array<{ id: string; state: string; states: string[] }>;
  };
  assert.ok(data.strategies.every((s) => s.states.join() === "on,off"));

  assert.equal((await api("PUT", "/api/reduction/paging", { state: "off" })).status, 200);
  const after = (await (await api("GET", "/api/reduction")).json()) as { strategies: Array<{ id: string; state: string }> };
  assert.equal(after.strategies.find((s) => s.id === "paging")!.state, "off");
  assert.equal((await api("PUT", "/api/reduction/paging", { state: "measure" })).status, 400);
  assert.equal((await api("PUT", "/api/reduction/nope", { state: "on" })).status, 400);
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
  assert.deepEqual(a.tokens, { input: 8, result: 150, saved: 60 });
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
  const base = { sessionId: "s4", project: dir, toolName: "Bash", promptId: "prompt-reason" };
  db.insertCall({ ...base, toolUseId: "r1", toolInput: { command: "rm -rf x" }, decision: "denied", ruleId: denyRule.id });
  db.insertCall({ ...base, toolUseId: "r2", toolInput: { command: "docker run nginx" }, decision: "would_deny" });
  db.insertCall({ ...base, toolUseId: "r3", toolInput: { command: "git status" }, decision: "allowed" });

  const calls = (await (await api("GET", `/api/calls?project=${encodeURIComponent(dir)}`)).json()) as Array<{
    toolUseId: string;
    reason: { kind: string; rule?: string; note?: string; effect?: string } | null;
  }>;
  const byRule = calls.find((c) => c.toolUseId === "r1")!.reason!;
  assert.deepEqual([byRule.kind, byRule.effect, byRule.rule, byRule.note], ["rule", "deny", "Shell(rm *)", denyRule.note]);
  assert.deepEqual(calls.find((c) => c.toolUseId === "r2")!.reason, { kind: "unlisted" });
  assert.equal(calls.find((c) => c.toolUseId === "r3")!.reason, null);
});

test("stats count denied calls, blocked or only logged", async () => {
  const denied = async () => ((await (await api("GET", "/api/stats")).json()) as { deniedCalls: number }).deniedCalls;
  const before = await denied();
  const base = { sessionId: "s6", project: dir, toolName: "Bash", toolInput: { command: "x" } };
  db.insertCall({ ...base, toolUseId: "st1", decision: "denied" });
  db.insertCall({ ...base, toolUseId: "st2", decision: "would_deny" });
  db.insertCall({ ...base, toolUseId: "st3", decision: "allowed" });
  assert.equal(await denied(), before + 2);
});

test("each call carries Claude's description of it, when the tool has one", async () => {
  const base = { sessionId: "s5", project: dir, promptId: "prompt-desc", decision: "allowed" as const };
  db.insertCall({ ...base, toolUseId: "d1", toolName: "Bash", toolInput: { command: "npm test", description: "Run the tests" } });
  db.insertCall({ ...base, toolUseId: "d2", toolName: "Read", toolInput: { file_path: "/x/a.ts" } });

  const calls = (await (await api("GET", `/api/calls?project=${encodeURIComponent(dir)}`)).json()) as Array<{
    toolUseId: string;
    summary: string;
    description: string | null;
  }>;
  const bash = calls.find((c) => c.toolUseId === "d1")!;
  assert.deepEqual([bash.description, bash.summary], ["Run the tests", "npm test"]);
  assert.equal(calls.find((c) => c.toolUseId === "d2")!.description, null);
});

type ExportedFile = { groups: Array<{ id: string; title: string; allow?: unknown[]; deny?: unknown[] }> };

test("rules can be exported, imported (replace or merge) and reset to defaults", async () => {
  const exported = (await (await api("GET", "/api/rules/export")).json()) as ExportedFile;
  assert.ok(exported.groups.length > 10);
  assert.ok(exported.groups.every((g) => g.id && g.title));

  const custom = {
    name: "Team rules",
    groups: [
      { id: "files", title: "The agent is allowed to read files", allow: ["Read"] },
      {
        id: "git",
        title: "The agent is allowed to use git, but not to delete",
        allow: [{ rule: "Shell(git *)", note: "git" }],
        deny: [{ rule: "Shell(rm *)", note: "no deleting" }],
      },
    ],
  };
  const preview = (await (await api("POST", "/api/rules/import/preview", { file: custom })).json()) as {
    rules: number;
    groups: Array<{ key: string; allow: number; deny: number }>;
    current: { rules: number };
  };
  assert.equal(preview.rules, 3);
  assert.deepEqual(
    preview.groups.map((g) => [g.key, g.allow, g.deny]),
    [
      ["files", 1, 0],
      ["git", 1, 1],
    ]
  );
  assert.ok(preview.current.rules > 10, "the preview changes nothing");

  const replaced = (await (await api("POST", "/api/rules/import", { file: custom, mode: "replace" })).json()) as {
    total: number;
    removed: number;
    groups: number;
  };
  assert.deepEqual([replaced.total, replaced.groups], [3, 2]);
  assert.ok(replaced.removed > 10);

  // Merging adds to the group with the same id, and new groups for new ids.
  const merged = (await (
    await api("POST", "/api/rules/import", {
      file: {
        groups: [
          { id: "files", title: "ignored, the group exists", allow: ["Read", "Grep"] },
          { id: "docker", title: "The agent is allowed to use Docker", allow: ["Shell(docker *)"] },
        ],
      },
      mode: "merge",
    })
  ).json()) as { added: number; total: number; addedGroups: number };
  assert.deepEqual([merged.added, merged.total, merged.addedGroups], [2, 5, 1]);
  const groups = (await (await api("GET", "/api/rule-groups")).json()) as Array<{ id: number; key: string; title: string }>;
  const files = groups.find((g) => g.key === "files")!;
  assert.equal(files.title, "The agent is allowed to read files");
  const rules = (await (await api("GET", "/api/rules")).json()) as Array<{ rule: string; group_id: number }>;
  assert.equal(rules.find((r) => r.rule === "Grep")?.group_id, files.id);

  // Older files without groups still import, as one group.
  const legacy = (await (
    await api("POST", "/api/rules/import", { file: { name: "Old", allow: ["Glob"] }, mode: "merge" })
  ).json()) as { added: number };
  assert.equal(legacy.added, 1);

  // Invalid files change nothing and list every problem.
  const bad = await api("POST", "/api/rules/import", { file: { allow: ["Shell(unclosed", 42] }, mode: "replace" });
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as { error: string }).error, /2 problem/);
  assert.equal(((await (await api("GET", "/api/rules")).json()) as unknown[]).length, 6);

  const defaults = (await (await api("GET", "/api/rules/defaults")).json()) as { version: number; rules: number };
  const defaultsPreview = (await (await api("GET", "/api/rules/defaults/preview")).json()) as { rules: number };
  assert.equal(defaultsPreview.rules, defaults.rules);
  const reset = (await (await api("POST", "/api/rules/reset", { mode: "replace" })).json()) as { total: number };
  assert.equal(reset.total, defaults.rules);
  assert.equal(
    ((await (await api("GET", "/api/rules/defaults")).json()) as { importedVersion: number }).importedVersion,
    defaults.version
  );
});

test("rule groups: create, add a rule, move, switch off, delete", async () => {
  const created = await api("POST", "/api/rule-groups", {
    title: "The agent is not allowed to use curl",
    description: "downloads",
  });
  assert.equal(created.status, 201);
  const { id: groupId } = (await created.json()) as { id: number };
  assert.equal((await api("POST", "/api/rule-groups", { title: "  " })).status, 400);

  const rule = (await (
    await api("POST", "/api/rules", { effect: "deny", rule: "Bash(curl *)", note: null, groupId })
  ).json()) as { id: number };
  const test = async () =>
    (await (await api("POST", "/api/rules/test", { call: "Bash(curl x)" })).json()) as {
      reason: string | null;
      rule: { group: string } | null;
    };
  assert.equal((await test()).rule?.group, "The agent is not allowed to use curl");

  // Switching the group off switches its rules off.
  assert.equal((await api("PATCH", `/api/rule-groups/${groupId}`, { enabled: false })).status, 200);
  assert.equal((await test()).reason, "unlisted");
  assert.equal((await api("PATCH", `/api/rule-groups/${groupId}`, { enabled: true, title: "No curl" })).status, 200);

  // A rule can move to another group.
  const other = (await (await api("POST", "/api/rule-groups", { title: "Downloads" })).json()) as { id: number };
  assert.equal((await api("PATCH", `/api/rules/${rule.id}`, { groupId: other.id })).status, 200);
  assert.equal((await test()).rule?.group, "Downloads");

  // Deleting a group deletes its rules.
  assert.equal((await api("DELETE", `/api/rule-groups/${other.id}`)).status, 200);
  assert.equal((await test()).reason, "unlisted");
  assert.equal((await api("DELETE", `/api/rule-groups/${other.id}`)).status, 404);
  assert.equal((await api("DELETE", `/api/rule-groups/${groupId}`)).status, 200);
});

test("export writes every rule as an object", async () => {
  const exported = (await (await api("GET", "/api/rules/export")).json()) as ExportedFile;
  const entries = exported.groups.flatMap((g) => [...(g.allow ?? []), ...(g.deny ?? [])]);
  assert.ok(entries.length > 100);
  assert.ok(entries.every((e) => typeof e === "object" && e !== null && "rule" in e));
});

test("dashboard shows captured Codex prompt text with its tool calls and no invented API usage", async () => {
  const { recordPrompt } = await import("../src/storage/tables/prompts");
  const promptId = "codex:dashboard-session:dashboard-turn";
  const rawText =
    '<in-app-browser-context source="ambient-ui-state">Browser context</in-app-browser-context>\n\n## My request:\nread the README';
  recordPrompt({ promptId, sessionId: "dashboard-session", integration: "codex", text: rawText });
  db.insertCall({
    toolUseId: "codex:dashboard-session:call",
    sessionId: "dashboard-session",
    promptId,
    integration: "codex",
    project: dir,
    toolName: "Bash",
    toolInput: { command: "cat README.md" },
    decision: "allowed",
  });
  const response = await api("GET", "/api/prompts?limit=100");
  assert.equal(response.status, 200);
  const groups = (await response.json()) as Array<{
    promptId: string;
    text: string;
    integration: string;
    calls: unknown[];
    usage: unknown;
  }>;
  const prompt = groups.find((g) => g.promptId === promptId)!;
  assert.equal(prompt.text, "read the README");
  const { getPrompt } = await import("../src/storage/tables/prompts");
  assert.equal(getPrompt(promptId)?.text, rawText);
  assert.equal(prompt.integration, "codex");
  assert.equal(prompt.calls.length, 1);
  assert.equal(prompt.usage, null);
});

test("merging default comments preserves user notes, disabled rules and groups", async () => {
  const { resetToDefaults, previewDefaults } = await import("../src/services/tool-security/rule-files/rule-sets");
  const table = await import("../src/storage/tables/tool-rules");
  const rules = table.listRules();
  const empty = rules.find((r) => r.source === "default" && r.rule === "Shell(git *)")!;
  const custom = rules.find((r) => r.source === "default" && r.rule === "Shell(rm *)")!;
  db.getDb().prepare("UPDATE tool_rules SET note = NULL, enabled = 0 WHERE id = ?").run(empty.id);
  db.getDb().prepare("UPDATE tool_rules SET note = 'My own explanation' WHERE id = ?").run(custom.id);
  assert.ok((previewDefaults().newComments ?? 0) >= 1);
  const merged = resetToDefaults("merge");
  assert.ok((merged.commentsFilled ?? 0) >= 1);
  const after = table.getRule(empty.id)!;
  assert.ok(after.note);
  assert.equal(after.enabled, 0);
  assert.equal(after.group_id, empty.group_id);
  assert.equal(table.getRule(custom.id)!.note, "My own explanation");
  assert.equal(resetToDefaults("merge").commentsFilled, 0);
});

test("captured prompts without calls are visible, filterable and reachable by encoded IDs", async () => {
  const { recordPrompt } = await import("../src/storage/tables/prompts");
  for (const integration of ["claude", "codex"]) {
    const promptId = `${integration}:standalone:turn`;
    recordPrompt({
      promptId,
      sessionId: "standalone",
      integration,
      text: "hello with no tool call",
      project: join(dir, "prompt-only"),
    });
    const response = await api("GET", `/api/prompts/${encodeURIComponent(promptId)}`);
    assert.equal(response.status, 200);
    const group = (await response.json()) as { text: string; calls: unknown[]; callCount: number; integration: string };
    assert.equal(group.text, "hello with no tool call");
    assert.equal(group.callCount, 0);
    assert.deepEqual(group.calls, []);
    assert.equal(group.integration, integration);
  }
  const filtered = (await (
    await api("GET", `/api/prompts?project=${encodeURIComponent(join(dir, "prompt-only"))}`)
  ).json()) as unknown[];
  assert.equal(filtered.length, 2);
});
