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
      PreToolUse: "apichap: Check tool permissions",
      PostToolUse: "apichap: Record tool result",
      PreCompact: "apichap: Reset context before compaction",
      SessionStart: "apichap: Initialize session context",
      UserPromptSubmit: "apichap: Capture user prompt",
    },
  });
}
export function uninstallHooks(options: { path?: string } = {}) {
  return shared.uninstallHooks({ path: options.path ?? defaultSettingsPath() });
}
