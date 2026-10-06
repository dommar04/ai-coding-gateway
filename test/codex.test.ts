import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { installHooks, uninstallHooks } from "../src/integrations/codex/settings";
import { toToolCall } from "../src/integrations/codex/hook-input";
import { evaluate } from "../src/services/tool-security/matching/engine";
import { loadDefaultRuleFile, parseRuleFile } from "../src/services/tool-security/rule-files/rule-file";
const dir = mkdtempSync(join(tmpdir(), "gateway-codex-"));
const base = {
  session_id: "session",
  cwd: dir,
  turn_id: "turn",
  tool_use_id: "call",
  tool_name: "Bash",
  tool_input: { command: "git status" },
  hook_event_name: "PreToolUse",
};
function hook(phase: string, input: unknown, mode = "enforce") {
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", join(__dirname, "../src/main.ts"), "hook", phase, "--agent", "codex"],
    {
      input: JSON.stringify(input),
      encoding: "utf8",
      env: { ...process.env, APICHAP_GATEWAY_DIR: dir, APICHAP_GATEWAY_MODE: mode },
    }
  );
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
test("Codex setup preserves hooks, uses regex matchers, and can be repeated and uninstalled", () => {
  const path = join(dir, "hooks.json");
  writeFileSync(
    path,
    JSON.stringify({ description: "existing", hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "my-check" }] }] } })
  );
  installHooks({ path, installed: true });
  assert.equal(installHooks({ path, installed: true }).replaced, 5);
  const settings = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(settings.description, "existing");
  assert.equal(settings.hooks.PreToolUse[1].matcher, ".*");
  assert.match(settings.hooks.PreToolUse[1].hooks[0].command, /hook pre --agent codex$/);
  assert.match(settings.hooks.UserPromptSubmit[0].hooks[0].command, /hook prompt --agent codex$/);
  assert.equal(uninstallHooks({ path }).removed, 5);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).hooks.PreToolUse[0].hooks[0].command, "my-check");
});
test("Codex uses shared enforcement and monitor behavior", () => {
  const input = { ...base, tool_input: { command: "rm -rf x" } };
  assert.equal(hook("pre", input).hookSpecificOutput.permissionDecision, "deny");
  assert.deepEqual(hook("pre", { ...input, tool_use_id: "monitor" }, "monitor"), {});
  assert.deepEqual(hook("pre", { ...base, tool_use_id: "allowed" }), {});
  assert.equal(hook("pre", {}).hookSpecificOutput.permissionDecision, "deny");
});
test("Codex post logs original output and zero savings without unsupported response fields", () => {
  const tool_response = "\x1b[32mOK\x1b[0m\n".repeat(100);
  assert.deepEqual(hook("post", { ...base, hook_event_name: "PostToolUse", tool_response }), {});
  const db = new DatabaseSync(join(dir, "gateway.sqlite"));
  const row = db.prepare("SELECT * FROM tool_calls WHERE tool_use_id = ?").get("codex:session:call")!;
  assert.equal(row.prompt_id, "codex:session:turn");
  assert.equal(row.tool_result, JSON.stringify(tool_response));
  assert.ok(Number(row.result_tokens) > 0);
  assert.equal(row.result_tokens_after, row.result_tokens);
  assert.equal(row.reduced_result, null);
  assert.equal(row.integration, "codex");
  db.close();
});
test("Codex patch checks every path, moves, secrets, and deletion permissions", () => {
  const call = (patch: string) => toToolCall({ ...base, tool_name: "apply_patch", tool_input: { command: patch } });
  const rules = [
    { id: 1, effect: "allow" as const, rule: "FileEdit({cwd}/**)", note: null },
    { id: 2, effect: "deny" as const, rule: "File(**/.env*)", note: null },
  ];
  const check = (patch: string) => {
    const c = call(patch);
    return evaluate({ ...c, home: dir }, rules);
  };
  assert.equal(check("*** Begin Patch\n*** Add File: a.ts\n+hello\n*** End Patch").decision, "allow");
  assert.equal(
    check("*** Begin Patch\n*** Update File: a.ts\n@@\n-a\n+b\n*** Add File: .env\n+secret\n*** End Patch").decision,
    "deny"
  );
  assert.equal(
    check("*** Begin Patch\n*** Update File: a.ts\n*** Move to: ../outside.ts\n@@\n-a\n+b\n*** End Patch").decision,
    "deny"
  );
  const deletion = check("*** Begin Patch\n*** Delete File: a.ts\n*** End Patch");
  assert.equal(deletion.decision, "deny");
  assert.throws(() => call("garbage"));
});
test("Codex session reset succeeds", () => {
  assert.deepEqual(hook("session", { session_id: "session", hook_event_name: "PreCompact" }), {});
});

test("defaults cover reported Codex web name and shared Bash pipelines while denying destructive commands", () => {
  const rules = parseRuleFile(loadDefaultRuleFile())
    .flatMap((g) => g.rules)
    .map((r, i) => ({ ...r, id: i + 1, note: r.note ?? null }));
  for (const toolName of ["webrun", "web.run", "web__run"]) {
    const call = toToolCall({ ...base, tool_name: toolName, tool_input: { search_query: [{ q: "Codex hooks" }] } });
    assert.equal(evaluate({ ...call, home: dir }, rules).decision, "allow");
  }
  for (const command of [
    "git status",
    "Get-Content README.md | Select-Object -First 20",
    "rg TODO src | Sort-Object | Out-String",
  ]) {
    const call = toToolCall({ ...base, tool_input: { command } });
    assert.equal(evaluate({ ...call, home: dir }, rules).decision, "allow", command);
  }
  const destructive = toToolCall({ ...base, tool_input: { command: "Get-Content README.md; Remove-Item README.md" } });
  assert.equal(evaluate({ ...destructive, home: dir }, rules).decision, "deny");
});

test("unknown integration fails before writing settings", () => {
  const path = join(dir, "unknown.json");
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", join(__dirname, "../src/main.ts"), "init", "--agent", "unknown", "--settings", path],
    { encoding: "utf8" }
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Unknown agent/);
  assert.equal(existsSync(path), false);
});

test("default rules protect Codex hooks from patch and shell edits", () => {
  const rules = parseRuleFile(loadDefaultRuleFile())
    .flatMap((g) => g.rules)
    .map((r, i) => ({ ...r, id: i + 1, note: r.note ?? null }));
  for (const file of [".codex/hooks.json", ".codex/config.toml"]) {
    const call = toToolCall({
      ...base,
      tool_name: "apply_patch",
      tool_input: { command: `*** Begin Patch\n*** Add File: ${file}\n+{}\n*** End Patch` },
    });
    const v = evaluate({ ...call, home: dir }, rules);
    assert.equal(v.decision, "deny");
    assert.equal(v.decision === "deny" && v.reason, "rule");
    assert.equal(
      evaluate({ toolName: "Bash", toolInput: { command: `echo test > ${file}` }, cwd: dir, home: dir }, rules).decision,
      "deny"
    );
  }
});

test("Codex prompt capture stores text by session and turn and tolerates bad payloads", () => {
  assert.deepEqual(
    hook("prompt", { session_id: "session", turn_id: "turn", prompt: "read a file again", hook_event_name: "UserPromptSubmit" }),
    {}
  );
  assert.deepEqual(
    hook("prompt", {
      session_id: "other-session",
      turn_id: "turn",
      prompt: "different session",
      hook_event_name: "UserPromptSubmit",
    }),
    {}
  );
  assert.deepEqual(hook("prompt", {}), {});
  const db = new DatabaseSync(join(dir, "gateway.sqlite"));
  assert.equal(db.prepare("SELECT text FROM prompts WHERE prompt_id = ?").get("codex:session:turn")!.text, "read a file again");
  assert.equal(
    db.prepare("SELECT text FROM prompts WHERE prompt_id = ?").get("codex:other-session:turn")!.text,
    "different session"
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM prompts").get()!.n, 2);
  db.close();
});
