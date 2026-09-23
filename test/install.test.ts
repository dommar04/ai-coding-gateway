import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hookCommand, installHooks, packageVersion, uninstallHooks } from "../src/integrations/claude/settings";

const tempSettings = (content?: unknown) => {
  const path = join(mkdtempSync(join(tmpdir(), "apichap-install-")), "settings.json");
  if (content !== undefined) writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  return path;
};
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));

test("hook command is a pinned, offline-first npx call", () => {
  assert.equal(hookCommand("pre"), `npx -y --prefer-offline @apichap/ai-coding-gateway@${packageVersion()} hook pre`);
  assert.equal(hookCommand("post", { installed: true }), "apichap-gateway hook post");
});

test("--local hooks run exactly the given copy: source with tsx, build with node", () => {
  assert.equal(hookCommand("pre", { localEntry: "C:\\dev\\gw\\src\\main.ts" }), 'npx tsx "C:/dev/gw/src/main.ts" hook pre');
  assert.equal(
    hookCommand("session", { localEntry: "/home/me/gw/dist/main.js" }),
    'node "/home/me/gw/dist/main.js" hook session'
  );

  // Switching between local and package hooks replaces the previous ones.
  const path = tempSettings();
  installHooks({ path, localEntry: "/home/me/gw/src/main.ts" });
  const again = installHooks({ path });
  assert.equal(again.replaced, 4);
  assert.equal(read(path).hooks.PreToolUse.length, 1);
  assert.equal(read(path).hooks.PreToolUse[0].hooks[0].command, hookCommand("pre"));
});

test("init creates settings.json when missing", () => {
  const path = tempSettings();
  const result = installHooks({ path });
  assert.equal(result.backup, null);
  const s = read(path);
  assert.equal(s.hooks.PreToolUse[0].matcher, "*");
  assert.equal(s.hooks.PreToolUse[0].hooks[0].command, hookCommand("pre"));
  assert.equal(s.hooks.PostToolUse[0].hooks[0].command, hookCommand("post"));
  assert.equal(s.hooks.PreCompact[0].hooks[0].command, hookCommand("session"));
  assert.equal(s.hooks.SessionStart[0].hooks[0].command, hookCommand("session"));
});

test("init keeps other settings and hooks, replaces older gateway hooks, and backs up", () => {
  const path = tempSettings({
    model: "opus",
    permissions: { allow: ["Bash(npm test)"] },
    hooks: {
      PreToolUse: [
        { matcher: "*", hooks: [{ type: "command", command: "npx tsx C:/dev/tokenreductiongateway/src/cli.ts hook pre" }] },
        { matcher: "Bash", hooks: [{ type: "command", command: "my-linter" }] },
      ],
      PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "claude-gateway hook post" }] }],
      Stop: [{ hooks: [{ type: "command", command: "notify" }] }],
    },
  });

  const result = installHooks({ path });
  assert.equal(result.replaced, 2);
  assert.ok(result.backup && existsSync(result.backup));

  const s = read(path);
  assert.equal(s.model, "opus");
  assert.deepEqual(s.permissions, { allow: ["Bash(npm test)"] });
  assert.deepEqual(s.hooks.Stop, [{ hooks: [{ type: "command", command: "notify" }] }]);
  const preCommands = s.hooks.PreToolUse.flatMap((e: { hooks: Array<{ command: string }> }) => e.hooks.map((h) => h.command));
  assert.deepEqual(preCommands, ["my-linter", hookCommand("pre")]);

  // Running init twice does not duplicate the hooks.
  installHooks({ path });
  assert.equal(read(path).hooks.PreToolUse.length, 2);
  assert.equal(read(path).hooks.PostToolUse.length, 1);
});

test("init refuses to touch invalid JSON", () => {
  const path = tempSettings("{ not json");
  assert.throws(() => installHooks({ path }), /not valid JSON/);
  assert.equal(readFileSync(path, "utf8"), "{ not json");
});

test("uninstall removes only the gateway hooks", () => {
  const path = tempSettings({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "my-linter" }] }] } });
  installHooks({ path });
  const result = uninstallHooks({ path });
  assert.equal(result.removed, 4);
  assert.deepEqual(read(path).hooks, { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "my-linter" }] }] });
  assert.equal(uninstallHooks({ path }).removed, 0);
});
