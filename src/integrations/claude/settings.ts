import { homedir } from "node:os";
import { join } from "node:path";
import * as shared from "../shared/settings";
export { hookCommand, packageVersion } from "../shared/settings";
export type { HookCommandOptions, InstallResult } from "../shared/settings";
export function defaultSettingsPath(): string {
  return join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "settings.json");
}
export function installHooks(options: { path?: string } & shared.HookCommandOptions = {}) {
  return shared.installHooks({
    ...options,
    path: options.path ?? defaultSettingsPath(),
    integration: "claude",
    capturePrompts: true,
  });
}
export function uninstallHooks(options: { path?: string } = {}) {
  return shared.uninstallHooks({ path: options.path ?? defaultSettingsPath() });
}
export function hooksInstalled(path?: string) {
  return shared.hooksInstalled(path ?? defaultSettingsPath());
}
