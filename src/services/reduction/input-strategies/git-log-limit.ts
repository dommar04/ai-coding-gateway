import { singleCommand } from "./single-command";
import type { InputStrategy } from "./types";

export const GIT_LOG_LIMIT = 50;

export const gitLogLimit: InputStrategy = {
  id: "git-log-limit",
  title: `Limit git log to ${GIT_LOG_LIMIT} commits`,
  description: `A plain \`git log\` without a count, range or date filter gets -n ${GIT_LOG_LIMIT}.`,
  group: "Before the call runs",
  defaultState: "off",
  applies: (t) => t === "Bash" || t === "PowerShell",
  rewrite: (input) => {
    const cmd = singleCommand(input, "bash");
    if (!cmd || !/^git log(\s|$)/.test(cmd)) return null;
    if (/(\s-n\s?\d|\s-\d+\b|--max-count|--since|--until|--after|--before|\.\.)/.test(cmd)) return null;
    return {
      input: { ...input, command: cmd.replace(/^git log/, `git log -n ${GIT_LOG_LIMIT}`) },
      note: `The apichap gateway limited this git log to ${GIT_LOG_LIMIT} commits. Add your own -n or a range to see more.`,
    };
  },
};
