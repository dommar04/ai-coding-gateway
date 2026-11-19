import { homedir } from "node:os";
import { join } from "node:path";
import * as shared from "../shared/settings";
export function defaultSettingsPath(): string {
  return join(process.env.CODEX_HOME || join(homedir(), ".codex"), "hooks.json");
}
export function installHooks(options: { path?: string } & shared.HookCommandOptions = {}) {
  return shared.installHooks({
    ...options,
    path: options.path ?? defaultSettingsPath(),
    integration: "codex",
    matcher: ".*",
    capturePrompts: true,
    statusMessages: {
      PreToolUse: "viewtower: Check tool permissions",
      PostToolUse: "viewtower: Record tool result",
      PreCompact: "viewtower: Reset context before compaction",
      SessionStart: "viewtower: Initialize session context",
      UserPromptSubmit: "viewtower: Capture user prompt",
    },
  });
}
export function uninstallHooks(options: { path?: string } = {}) {
  return shared.uninstallHooks({ path: options.path ?? defaultSettingsPath() });
}
export function hooksInstalled(path?: string) {
  return shared.hooksInstalled(path ?? defaultSettingsPath());
}
