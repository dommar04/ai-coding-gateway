import { runList } from "./activity";
import { runDashboard } from "./dashboard";
import { runHook } from "./hook";
import { runReduction } from "./reduction";
import { runRequests } from "./requests";
import { runRules } from "./rules";
import { runMode, runPolicy } from "./settings";
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
  requests: runRequests,
  mode: (args) => runMode(args[0]),
  policy: (args) => runPolicy(args[0]),
  reduction: runReduction,
};

export const USAGE = [
  "  apichap-gateway init [--installed | --local] [--settings path]   (register the hooks in Claude Code)",
  "  apichap-gateway uninstall [--settings path]  (remove the hooks again)",
  "  apichap-gateway reduction [list] | set <id> on|measure|off   (token reduction options)",
  "  apichap-gateway hook pre|post|session                 (invoked by Claude Code hooks, reads JSON from stdin)",
  "  apichap-gateway list [n]                      (print the last n logged tool calls, default 20)",
  "  apichap-gateway rules [list]                  (show allow/deny rules)",
  '  apichap-gateway rules add allow|deny "Tool(pattern)" [--note "why"]',
  "  apichap-gateway rules enable|disable|remove <id>",
  '  apichap-gateway rules test "Bash(some command)" [--cwd path]   (dry-run a call against the rules)',
  "  apichap-gateway rules export [--out rules.json]            (all rules as a rule file)",
  "  apichap-gateway rules import <rules.json> [--merge]        (replace all rules; --merge only adds new ones)",
  "  apichap-gateway rules reset [--merge]                      (back to the default rules)",
  "  apichap-gateway requests [list] [--all]       (show approval requests)",
  '  apichap-gateway requests approve <id> [--broad | --rule "Tool(pattern)"]',
  "  apichap-gateway requests reject <id>",
  "  apichap-gateway mode [enforce|monitor|off]    (show or set enforcement mode)",
  "  apichap-gateway policy [local|managed]        (managed = rules are read-only on this machine)",
  "  apichap-gateway dashboard [--port 4717] [--no-open]   (local web dashboard)",
];
