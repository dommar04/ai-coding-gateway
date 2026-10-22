import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveRange } from "./helper/ci";
import {
  checkHistory,
  defaultBranch,
  emptyTree,
  fileAtHead,
  rangeDiff,
  repoRoot,
  traceFiles,
  traceInRange,
  type FileDiff,
  type Range,
} from "./helper/git";
import { renderReport, type ReportData, type ReportFile } from "./html/html";
import { writeGitHubOutput } from "./github/github";
import { writeCodeQuality, type AiFile } from "./gitlab/gitlab";
import { matchFile } from "./helper/matcher";
import { readTrace, type TracedChange } from "./helper/traces";

// The AI change report for a merge request or push (or, locally, the current branch):
//   1. which commits to compare (CI, --base, or the default branch)
//   2. the agent trace lines those commits add, and their diff
//   3. per changed file: find the recorded AI content in the file at the head commit
//   4. write the HTML report
//   5. in GitHub Actions: the run's summary, and a check with one annotation per AI file in the pull request;
//      in GitLab CI: a Code Quality report of all AI code at the head commit, one finding per AI line block
//      (branch pipelines write only that report: runCodeQualityReport)
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
  const traces = traceFiles(range, root);
  for (const file of traces) {
    const read = readTrace(file, traceInRange(range, file, root));
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
    sessions: traces.length,
    missing: files.reduce((n, f) => n + f.missing, elsewhere),
    warnings,
  };
  const out = resolve(cwd, options.out ?? "goairside-report");
  mkdirSync(out, { recursive: true });
  const file = join(out, "index.html");
  writeFileSync(file, renderReport(data));

  // 5. CI output
  await writeGitHubOutput(data, range.head, options.env ?? process.env);
  if ((options.env ?? process.env).GITLAB_CI === "true") writeCodeQuality(aiCodeAt(range.head, root), out);
  return { file, data };
}

/** Only the GitLab Code Quality report, of all AI code at `head` (default HEAD). Returns its path. */
export function runCodeQualityReport(options: Pick<ReportOptions, "head" | "out" | "cwd"> = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const root = repoRoot(cwd);
  const out = resolve(cwd, options.out ?? "goairside-report");
  mkdirSync(out, { recursive: true });
  return writeCodeQuality(aiCodeAt(options.head ?? "HEAD", root), out);
}

/** All AI changes at `head`: every change in every trace file there, matched against the whole file for its lines. */
function aiCodeAt(head: string, root: string): AiFile[] {
  const range: Range = { base: emptyTree(root), head, dots: ".." };
  const changes = traceFiles(range, root).flatMap((file) => readTrace(file, fileAtHead(range, file, root)).changes);
  return [...new Set(changes.map((c) => c.path))].flatMap((path) => {
    let content: string;
    try {
      content = fileAtHead(range, path, root);
    } catch {
      return []; // Deleted or renamed since.
    }
    const own = changes.filter((c) => c.path === path);
    const lines = new Set(content.split("\n").map((_, i) => i + 1));
    return [{ path, changes: own, spans: matchFile(content, lines, own).spans }];
  });
}

function addedLines(f: FileDiff): Set<number> {
  const lines = new Set<number>();
  for (const h of f.hunks) for (const l of h.lines) if (l.type === "add" && l.newLine !== undefined) lines.add(l.newLine);
  return lines;
}
