import { isShell, isMcp, type OutputStrategy } from "./shared";

export const repeatedLines: OutputStrategy = {
  id: "repeated-lines",
  title: "Collapse repeated lines",
  description: "Replaces 3+ identical consecutive lines with one line and a repeat count.",
  group: "Lossless cleanup",
  defaultState: "on",
  applies: (t) => isShell(t) || isMcp(t),
  apply: (text) => {
    const lines = text.split("\n");
    const out: string[] = [];
    for (let i = 0; i < lines.length;) {
      let j = i + 1;
      while (j < lines.length && lines[j] === lines[i]) j++;
      const count = j - i;
      if (count >= 3 && lines[i].trim()) out.push(lines[i], `⋯ (same line repeated ${count - 1} more times)`);
      else out.push(...lines.slice(i, j));
      i = j;
    }
    return out.join("\n");
  },
};
