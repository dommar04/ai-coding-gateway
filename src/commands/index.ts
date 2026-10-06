import { runList } from "./activity";
import { runDashboard } from "./dashboard";
import { runHook } from "./hook";
import { runReduction } from "./reduction";
import { runRules } from "./rules";
import { runMode } from "./settings";
import { runInit, runUninstall } from "./setup";

// The command table: which command runs what (like the routes of a web app).

export type Command = (args: string[]) => void | Promise<void>;

export const COMMANDS: Record<string, Command> = {
  hook: runHook,
  init: runInit,
  uninstall: runUninstall,
  dashboard: runDashboard,
  list: (args) => runList(Number(args[0]) > 0 ? Number(args[0]) : 20),
  rules: runRules,
  mode: (args) => runMode(args[0]),
  reduction: runReduction,
};

export const USAGE = [
  "  apichap-gateway init --agent claude|codex [--installed | --local] [--settings path]   (register agent hooks)",
  "  apichap-gateway uninstall --agent claude|codex [--settings path]  (remove the hooks again)",
  "  apichap-gateway reduction [list] | set <id> on|off   (token reduction options)",
  "  apichap-gateway hook pre|post|session --agent claude|codex   (agent hooks, reads JSON from stdin)",
  "  apichap-gateway list [n]                      (print the last n logged tool calls, default 20)",
  "  apichap-gateway rules [list]                  (show the rule groups and their rules)",
  '  apichap-gateway rules add allow|deny "Tool(pattern)" [--note "why"] [--group <key>]',
  "  apichap-gateway rules enable|disable|remove <id>",
  "  apichap-gateway rules move <id> <group key>",
  '  apichap-gateway rules groups [list] | add "The agent is not allowed to ..." [--description "why"]',
  "  apichap-gateway rules groups enable|disable|remove <group key>",
  '  apichap-gateway rules test "Bash(some command)" [--cwd path]   (dry-run a call against the rules)',
  "  apichap-gateway rules export [--out rules.json]            (all rules as a rule file)",
  "  apichap-gateway rules import <rules.json> [--merge]        (replace all rules; --merge only adds new ones)",
  "  apichap-gateway rules reset [--merge]                      (back to the default rules)",
  "  apichap-gateway mode [enforce|monitor|off]    (show or set enforcement mode)",
  "  apichap-gateway dashboard [--port 4717] [--no-open]   (local web dashboard)",
];
