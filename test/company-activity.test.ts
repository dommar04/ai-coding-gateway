import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the gateway at a throwaway database before any gateway module is loaded.
const dir = mkdtempSync(join(tmpdir(), "apichap-gateway-test-"));
process.env.APICHAP_GATEWAY_DIR = dir;
process.env.APICHAP_GATEWAY_SERVER = "https://company.test/";

type Modules = typeof import("../src/services/company/activity") &
  typeof import("../src/services/company/api") &
  typeof import("../src/storage/tables/settings") &
  typeof import("../src/storage/tables/tool-calls") &
  typeof import("../src/storage/database");

let m: Modules;
const realFetch = globalThis.fetch;

before(async () => {
  m = {
    ...(await import("../src/services/company/activity")),
    ...(await import("../src/services/company/api")),
    ...(await import("../src/storage/tables/settings")),
    ...(await import("../src/storage/tables/tool-calls")),
    ...(await import("../src/storage/database")),
  };
  m.storeTokens({ access_token: "tok", refresh_token: "ref", expires_in: 3600 }, "dev@company.test");
});

after(() => {
  globalThis.fetch = realFetch;
  m.closeDb();
  rmSync(dir, { recursive: true, force: true });
});

let bodies: Array<{ events: Array<Record<string, unknown>> }>;
let status: number;

beforeEach(() => {
  bodies = [];
  status = 200;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ accepted: 0 }), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  m.resetActivityCursor();
});

const config = (approved: boolean, denied: boolean) =>
  m.setSetting(
    "company:config",
    JSON.stringify({
      sync_approved_activities: approved,
      sync_denied_activities: denied,
      enable_traces: false,
      enable_github_pipeline: false,
    })
  );

let n = 0;
function call(decision: "allowed" | "denied" | "would_deny") {
  const toolUseId = `t${++n}`;
  m.insertCall({ toolUseId, sessionId: "s1", project: "/p", toolName: "Bash", toolInput: { command: "cat .env" }, decision });
  return toolUseId;
}

test("only opted-in decisions are sent, without tool input", async () => {
  config(false, true);
  call("allowed");
  const denied = call("denied");
  const wouldDeny = call("would_deny");

  assert.equal(await m.uploadActivity(), 2);

  assert.equal(bodies.length, 1);
  assert.deepEqual(
    bodies[0].events.map((e) => [e.tool_use_id, e.decision, e.agent, e.tool_name]),
    [
      [denied, "denied", "claude", "Bash"],
      [wouldDeny, "would_deny", "claude", "Bash"],
    ]
  );
  assert.ok(!JSON.stringify(bodies).includes(".env"));
  // Cursor moved past all three: nothing is sent again.
  assert.equal(await m.uploadActivity(), 0);
  assert.equal(bodies.length, 1);
});

test("a failed upload keeps the cursor, the next tick retries", async () => {
  config(true, true);
  const id = call("allowed");
  status = 500;
  await assert.rejects(m.uploadActivity(), /Server error 500/);
  status = 200;
  assert.equal(await m.uploadActivity(), 1);
  assert.equal(bodies.at(-1)!.events[0].tool_use_id, id);
});

test("calls before the login are never sent", async () => {
  config(true, true);
  call("allowed");
  m.resetActivityCursor(); // what login does
  assert.equal(await m.uploadActivity(), 0);
  assert.equal(bodies.length, 0);
});
