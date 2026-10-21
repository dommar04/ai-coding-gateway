import { runDashboard } from "./commands/dashboard";
import { runHook } from "./commands/hook";
import { runReport } from "./commands/report";
import { runInit, runUninstall } from "./commands/setup";

// The command table: which command runs what (like the routes of a web app).

export type Command = (args: string[]) => void | Promise<void>;

export const COMMANDS: Record<string, Command> = {
  hook: runHook,
  init: runInit,
  uninstall: runUninstall,
  dashboard: runDashboard,
  report: runReport,
};

export const USAGE = [
  "  apichap-gateway init --agent claude|codex [--installed | --local] [--settings path]   (register agent hooks)",
  "  apichap-gateway uninstall --agent claude|codex [--settings path]  (remove the hooks again)",
  "  apichap-gateway dashboard [--port 4717] [--no-open]   (local web dashboard: activity, rules, mode, token savings)",
  "  apichap-gateway report [--base <branch|commit>] [--head <commit>] [--out goairside-report]   (AI change report; in CI the range comes from the merge request or push)",
];
