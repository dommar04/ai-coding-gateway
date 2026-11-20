import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hookCommand, hooksInstalled, installHooks, packageVersion, uninstallHooks } from "../src/integrations/claude/settings";
import { installRuntime } from "../src/integrations/shared/runtime";

test("installRuntime copies the package to a fixed folder and replaces an older copy", () => {
  const root = mkdtempSync(join(tmpdir(), "viewtower-runtime-"));
  const from = join(root, "pkg");
  const dir = join(root, "runtime");
  mkdirSync(join(from, "dist"), { recursive: true });
  writeFileSync(join(from, "dist", "main.js"), "// v1");
  writeFileSync(join(from, "dist", "old.js"), "");
  writeFileSync(join(from, "package.json"), "{}");
  assert.equal(installRuntime(from, dir), join(dir, "dist", "main.js"));
  assert.equal(readFileSync(join(dir, "dist", "main.js"), "utf8"), "// v1");

  // A new version replaces the whole copy: files it no longer has are gone.
  rmSync(join(from, "dist", "old.js"));
  writeFileSync(join(from, "dist", "main.js"), "// v2");
  installRuntime(from, dir);
  assert.equal(readFileSync(join(dir, "dist", "main.js"), "utf8"), "// v2");
  assert.equal(existsSync(join(dir, "dist", "old.js")), false);
  assert.equal(existsSync(join(dir, "package.json")), true);

  // Run from the copy itself: nothing to copy.
  assert.equal(installRuntime(dir, dir), join(dir, "dist", "main.js"));
  // A source checkout without a build is refused.
  assert.throws(() => installRuntime(join(root, "nobuild"), join(root, "rt2")), /No build found/);
});

const tempSettings = (content?: unknown) => {
  const path = join(mkdtempSync(join(tmpdir(), "viewtower-install-")), "settings.json");
  if (content !== undefined) writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  return path;
};
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));

test("hook command is a pinned, offline-first npx call", () => {
  assert.equal(
    hookCommand("pre", { integration: "claude" }),
    `npx -y --prefer-offline viewtower@${packageVersion()} hook pre --agent claude`
  );
  assert.equal(hookCommand("post", { integration: "claude", installed: true }), "viewtower hook post --agent claude");
});

test("--local hooks run exactly the given copy: source with tsx, build with node", () => {
  assert.equal(
    hookCommand("pre", { integration: "claude", localEntry: "C:\\dev\\gw\\src\\main.ts" }),
    'npx tsx "C:/dev/gw/src/main.ts" hook pre --agent claude'
  );
  assert.equal(
    hookCommand("session", { integration: "claude", localEntry: "/home/me/gw/dist/main.js" }),
    'node "/home/me/gw/dist/main.js" hook session --agent claude'
  );

  // Switching between local and package hooks replaces the previous ones.
  const path = tempSettings();
  installHooks({ path, localEntry: "/home/me/gw/src/main.ts" });
  const again = installHooks({ path });
  assert.equal(again.replaced, 5);
  assert.equal(read(path).hooks.PreToolUse.length, 1);
  assert.equal(read(path).hooks.PreToolUse[0].hooks[0].command, hookCommand("pre", { integration: "claude" }));
});

test("init creates settings.json when missing", () => {
  const path = tempSettings();
  const result = installHooks({ path });
  assert.equal(result.backup, null);
  const s = read(path);
  assert.equal(s.hooks.PreToolUse[0].matcher, "*");
  assert.equal(s.hooks.PreToolUse[0].hooks[0].command, hookCommand("pre", { integration: "claude" }));
  assert.equal(s.hooks.PostToolUse[0].hooks[0].command, hookCommand("post", { integration: "claude" }));
  assert.equal(s.hooks.PreCompact[0].hooks[0].command, hookCommand("session", { integration: "claude" }));
  assert.equal(s.hooks.SessionStart[0].hooks[0].command, hookCommand("session", { integration: "claude" }));
});

test("init keeps other settings and hooks, replaces older gateway hooks, and backs up", () => {
  const path = tempSettings({
    model: "opus",
    permissions: { allow: ["Bash(npm test)"] },
    hooks: {
      PreToolUse: [
        { matcher: "*", hooks: [{ type: "command", command: 'npx tsx "C:/dev/gw/src/main.ts" hook pre --agent claude' }] },
        { matcher: "Bash", hooks: [{ type: "command", command: "my-linter" }] },
        // Another tool with a cli.js/main.js and a "hook pre" subcommand is not ours.
        { matcher: "*", hooks: [{ type: "command", command: "node /x/other/dist/cli.js hook pre" }] },
        { matcher: "*", hooks: [{ type: "command", command: 'node "/x/other/dist/main.js" hook pre' }] },
      ],
      PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "viewtower hook post" }] }],
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
  assert.deepEqual(preCommands, [
    "my-linter",
    "node /x/other/dist/cli.js hook pre",
    'node "/x/other/dist/main.js" hook pre',
    hookCommand("pre", { integration: "claude" }),
  ]);

  // Running init twice does not duplicate the hooks.
  installHooks({ path });
  assert.equal(read(path).hooks.PreToolUse.length, 4);
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
  assert.equal(result.removed, 5);
  assert.deepEqual(read(path).hooks, { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "my-linter" }] }] });
  assert.equal(uninstallHooks({ path }).removed, 0);
});

test("hooksInstalled is true only while every gateway hook is still registered", () => {
  const path = tempSettings();
  assert.equal(hooksInstalled(path), false);
  installHooks({ path });
  assert.equal(hooksInstalled(path), true);
  const s = read(path);
  delete s.hooks.PreToolUse;
  writeFileSync(path, JSON.stringify(s));
  assert.equal(hooksInstalled(path), false);
});
