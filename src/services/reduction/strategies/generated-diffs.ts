import { isShell, NOTE, type OutputStrategy } from "./shared";

const GENERATED_FILE =
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|Pipfile\.lock|composer\.lock|Gemfile\.lock|go\.sum)$|\.min\.(js|css)$|\.map$|(^|\/)(dist|build)\//;

export const generatedDiffs: OutputStrategy = {
  id: "generated-diffs",
  title: "Summarize lockfile & generated diffs",
  description: "In git diff output, replaces hunks of lockfiles, minified files, source maps and dist/ with a +/− line count.",
  group: "Condense noisy output",
  defaultState: "on",
  applies: isShell,
  apply: (text) => {
    if (!text.includes("diff --git ")) return text;
    const parts = text.split(/(?=^diff --git )/m);
    return parts
      .map((part) => {
        const m = /^diff --git a\/(\S+) b\/(\S+)/.exec(part);
        if (!m || !GENERATED_FILE.test(m[2])) return part;
        const lines = part.split("\n");
        const added = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
        const removed = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
        if (added + removed < 20) return part;
        return `${lines[0]}\n${NOTE} generated file: +${added} −${removed} lines omitted\n`;
      })
      .join("");
  },
};
