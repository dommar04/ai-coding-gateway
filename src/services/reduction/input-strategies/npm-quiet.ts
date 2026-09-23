import { singleCommand } from "./single-command";
import type { InputStrategy } from "./types";

export const npmQuiet: InputStrategy = {
  id: "npm-quiet",
  title: "Quiet npm installs",
  description: "Adds --no-audit --no-fund --no-progress to plain `npm install` / `npm ci` commands.",
  group: "Before the call runs",
  defaultState: "off",
  applies: (t) => t === "Bash" || t === "PowerShell",
  rewrite: (input) => {
    const cmd = singleCommand(input, "bash");
    if (!cmd || !/^npm (install|i|ci)(\s|$)/.test(cmd) || /--(no-)?(audit|fund|progress)\b/.test(cmd)) return null;
    return {
      input: { ...input, command: `${cmd} --no-audit --no-fund --no-progress` },
      note: "The apichap gateway added --no-audit --no-fund --no-progress to this npm command to keep its output short.",
    };
  },
};
