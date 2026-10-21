import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveRange } from "./helper/ci";
import { checkHistory, defaultBranch, fileAtHead, newTraceFiles, rangeDiff, repoRoot, type FileDiff } from "./helper/git";
import { renderReport, type ReportData, type ReportFile } from "./html/html";
import { writeGitHubOutput } from "./github/github";
import { matchFile } from "./helper/matcher";
import { readTrace, type TracedChange } from "./helper/traces";

// The AI change report for a merge request or push (or, locally, the current branch):
//   1. which commits to compare (CI, --base, or the default branch)
//   2. the agent traces those commits add, and their diff
//   3. per changed file: find the recorded AI content in the file at the head commit
//   4. write the HTML report
//   5. in GitHub Actions: the run's summary, and a check with one annotation per AI file in the pull request
// Runs locally (git and the files in the checkout). The only network access is that check, to GitHub
// itself (github/checks.ts), and only when the workflow grants `checks: write` and passes the token.

export interface ReportOptions {
  base?: string;
  head?: string;
  /** Folder for index.html (default: goairside-report, relative to cwd). */
  out?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}

export interface ReportResult {
  /** Path of the written index.html. */
  file: string;
  data: ReportData;
}

export async function runReport(options: ReportOptions = {}): Promise<ReportResult> {
  const cwd = options.cwd ?? process.cwd();
  const root = repoRoot(cwd);

  // 1. Which commits
  const range = resolveRange(options, options.env ?? process.env, () => defaultBranch(root));
  checkHistory(range, root);

  // 2. Traces and diff
  const warnings: string[] = [];
  const changes: TracedChange[] = [];
  const traceFiles = newTraceFiles(range, root);
  for (const file of traceFiles) {
    const read = readTrace(file, fileAtHead(range, file, root));
    changes.push(...read.changes);
    warnings.push(...read.warnings);
  }
  const diff = rangeDiff(range, root);

  // 3. Matching, per changed file (a renamed file's changes may still use its old path)
  const matched = new Set<TracedChange>();
  const files: ReportFile[] = diff.map((f) => {
    const own = changes.filter((c) => c.path === f.path || (f.oldPath !== undefined && c.path === f.oldPath));
    own.forEach((c) => matched.add(c));
    const m = matchFile(fileAtHead(range, f.path, root), addedLines(f), own);
    return { ...f, spans: m.spans, addedTokens: m.addedTokens, aiTokens: m.aiTokens, missing: m.missing.length };
  });
  // Changes to files the diff doesn't contain (reverted, deleted) are no longer present either.
  const elsewhere = changes.filter((c) => !matched.has(c)).length;

  // 4. Report
  const data: ReportData = {
    subject: range.label ?? `${range.base}${range.dots}${range.head}`,
    generatedAt: options.now ?? new Date(),
    files,
    sessions: traceFiles.length,
    missing: files.reduce((n, f) => n + f.missing, elsewhere),
    warnings,
  };
  const out = resolve(cwd, options.out ?? "goairside-report");
  mkdirSync(out, { recursive: true });
  const file = join(out, "index.html");
  writeFileSync(file, renderReport(data));

  // 5. CI output
  await writeGitHubOutput(data, range.head, options.env ?? process.env);
  return { file, data };
}

function addedLines(f: FileDiff): Set<number> {
  const lines = new Set<number>();
  for (const h of f.hunks) for (const l of h.lines) if (l.type === "add" && l.newLine !== undefined) lines.add(l.newLine);
  return lines;
}
