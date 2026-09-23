import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// End to end: run the real hook command with JSON on stdin, as Claude Code does.
const dir = mkdtempSync(join(tmpdir(), "apichap-hooks-"));
const cli = join(__dirname, "..", "src", "main.ts");

function hook(phase: string, input: unknown): Record<string, unknown> {
  const r = spawnSync(process.execPath, ["--import", "tsx", cli, "hook", phase], {
    input: JSON.stringify(input),
    env: { ...process.env, APICHAP_GATEWAY_DIR: dir, APICHAP_GATEWAY_MODE: "enforce" },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout || "{}");
}

const base = { session_id: "s1", prompt_id: "p1", cwd: dir, transcript_path: join(dir, "none.jsonl") };

test("PostToolUse replaces a noisy Bash result in the tool's own shape", () => {
  const stdout = "\x1b[32mok\x1b[0m\n" + Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n");
  const out = hook("post", {
    ...base,
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_use_id: "tu1",
    tool_input: { command: "x" },
    tool_response: { stdout, stderr: "", interrupted: false, isImage: false },
    duration_ms: 12,
  });
  const hso = out.hookSpecificOutput as { hookEventName: string; updatedToolOutput: { stdout: string; interrupted: boolean } };
  assert.equal(hso.hookEventName, "PostToolUse");
  assert.equal(hso.updatedToolOutput.interrupted, false);
  assert.ok(!hso.updatedToolOutput.stdout.includes("\x1b"));
  assert.match(hso.updatedToolOutput.stdout, /Output shortened/);
});

test("PostToolUse leaves small, clean results alone", () => {
  const out = hook("post", {
    ...base,
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_use_id: "tu2",
    tool_input: { command: "pwd" },
    tool_response: { stdout: "/home/me", stderr: "", interrupted: false, isImage: false },
  });
  assert.deepEqual(out, {});
});

test("PreToolUse still denies by rule in enforce mode", () => {
  const out = hook("pre", {
    ...base,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_use_id: "tu3",
    tool_input: { command: "rm -rf x" },
  });
  assert.equal((out.hookSpecificOutput as { permissionDecision: string }).permissionDecision, "deny");
});

test("session hook runs without output", () => {
  assert.deepEqual(hook("session", { session_id: "s1", hook_event_name: "PreCompact" }), {});
});
