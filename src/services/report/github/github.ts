import { appendFileSync } from "node:fs";
import type { ReportData, ReportFile } from "../html/html";
import { describe, percent } from "../html/html";

// The report inside GitHub, without any API call or token:
//   - notices: workflow commands in the log, shown next to the AI code in the pull request's "Files changed"
//   - the step summary: Markdown on the run's summary page
// GitHub shows at most 10 notices per step, so only the largest AI blocks get one.

const MAX_NOTICES = 10;

export interface AiBlock {
  path: string;
  line: number;
  endLine: number;
  message: string;
}

/** Writes the notices to stdout and the summary to $GITHUB_STEP_SUMMARY, when running in GitHub Actions. */
export function writeGitHubOutput(data: ReportData, env: NodeJS.ProcessEnv = process.env): void {
  if (env.GITHUB_ACTIONS !== "true") return;
  const blocks = aiBlocks(data.files);
  for (const b of blocks.slice(0, MAX_NOTICES)) console.log(notice(b));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, stepSummary(data, blocks.length));
}

/** AI spans on neighbouring lines of a file, as one block each; largest first. */
export function aiBlocks(files: ReportFile[]): AiBlock[] {
  const blocks: Array<AiBlock & { changes: Set<string> }> = [];
  for (const f of files) {
    let block: (AiBlock & { changes: Set<string> }) | null = null;
    for (const s of [...f.spans].sort((a, b) => a.line - b.line)) {
      if (block && s.line <= block.endLine + 1) {
        block.endLine = s.line;
      } else {
        block = { path: f.path, line: s.line, endLine: s.line, message: "", changes: new Set() };
        blocks.push(block);
      }
      block.changes.add(describe(s.change));
    }
  }
  return blocks
    .map(({ changes, ...b }) => ({ ...b, message: [...changes].join("\n") }))
    .sort((a, b) => b.endLine - b.line - (a.endLine - a.line));
}

/** A notice workflow command (values escaped as GitHub requires). */
export function notice(b: AiBlock): string {
  const prop = (v: string) => escapeData(v).replace(/:/g, "%3A").replace(/,/g, "%2C");
  return `::notice file=${prop(b.path)},line=${b.line},endLine=${b.endLine},title=${prop("AI-written code")}::${escapeData(b.message)}`;
}

function escapeData(v: string): string {
  return v.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

export function stepSummary(data: ReportData, blockCount: number): string {
  const added = data.files.reduce((n, f) => n + f.addedTokens, 0);
  const ai = data.files.reduce((n, f) => n + f.aiTokens, 0);
  const aiFiles = data.files.filter((f) => f.aiTokens > 0).sort((a, b) => b.aiTokens - a.aiTokens);
  const models = [...new Set(data.files.flatMap((f) => f.spans.map((s) => s.change.model ?? "unknown model")))];
  const cell = (s: string) => s.replace(/\|/g, "\\|");
  const lines = [
    `## goAirside AI change report`,
    ``,
    `**${percent(ai, added)}** of the new code was written by AI · ${data.subject}`,
    ``,
    `| AI share | Files with AI code | Models | Sessions | No longer present |`,
    `| --- | --- | --- | --- | --- |`,
    `| ${percent(ai, added)} (${ai} of ${added} tokens) | ${aiFiles.length} / ${data.files.length} | ${cell(models.join(", ") || "none")} | ${data.sessions} | ${data.missing} |`,
    ``,
  ];
  if (aiFiles.length) {
    lines.push(`| File | AI share |`, `| --- | --- |`);
    for (const f of aiFiles) lines.push(`| \`${cell(f.path)}\` | ${percent(f.aiTokens, f.addedTokens)} |`);
    lines.push(``);
  }
  if (blockCount > MAX_NOTICES)
    lines.push(`The ${MAX_NOTICES} largest of ${blockCount} AI blocks are marked in the pull request's changes.`, ``);
  lines.push(`The full report with the highlighted code is in the **goairside-report** artifact below.`, ``);
  return lines.join("\n");
}
