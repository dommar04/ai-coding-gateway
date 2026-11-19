import { runDashboard } from "./commands/dashboard";
import { runHook } from "./commands/hook";
import { runLogin, runLogout } from "./commands/login";
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
  login: runLogin,
  logout: runLogout,
};

export const USAGE = [
  "  viewtower init --agent claude|codex [--login [email]] [--dashboard] [--installed | --local] [--settings path]   (register agent hooks; --login also logs in; the dashboard starts in the background)",
  "  viewtower uninstall --agent claude|codex [--settings path]  (remove the hooks again)",
  "  viewtower login [--email you@company.com] [--server url]   (log in to your company; rules sync automatically)",
  "  viewtower logout   (end the company login; rules become editable again)",
  "  viewtower dashboard [--port 4717] [--no-open]   (local web dashboard: activity, rules, mode, token savings)",
  "  viewtower report [--base <branch|commit>] [--head <commit>] [--out viewtower-report]   (AI change report; in CI the range comes from the merge request or push)",
];
