import { appendFileSync } from "node:fs";
import type { ReportData, ReportFile } from "../html/html";
import { percent } from "../html/html";
import { createCheck, type CheckAnnotation } from "./checks";
import { lineRanges } from "../helper/lines";

// The report inside GitHub:
//   - the step summary: Markdown on the run's summary page (always)
//   - a "goAirside" check on the pull request, with one annotation per file that has AI code, shown in
//     "Files changed" (needs `checks: write` and the token in the workflow; otherwise skipped)

/** Writes the step summary and creates the check, when running in GitHub Actions. */
export async function writeGitHubOutput(data: ReportData, headSha: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (env.GITHUB_ACTIONS !== "true") return;
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, stepSummary(data));

  const runUrl =
    env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
      ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
      : undefined;
  const added = data.files.reduce((n, f) => n + f.addedTokens, 0);
  const ai = data.files.reduce((n, f) => n + f.aiTokens, 0);
  const result = await createCheck(
    {
      headSha,
      title: `${percent(ai, added)} of the new code is AI-written`,
      summary: stepSummary(data),
      detailsUrl: runUrl,
      annotations: fileAnnotations(data.files, runUrl),
    },
    env
  );
  if (result !== "created") console.log(`goAirside check skipped: ${result}`);
}

/** One annotation per file with AI code, on its first AI line. */
export function fileAnnotations(files: ReportFile[], runUrl?: string): CheckAnnotation[] {
  return files
    .filter((f) => f.spans.length)
    .map((f) => {
      const lines = [...new Set(f.spans.map((s) => s.line))].sort((a, b) => a - b);
      const models = [...new Set(f.spans.map((s) => s.change.model ?? "unknown model"))];
      return {
        path: f.path,
        start_line: lines[0],
        end_line: lines[0],
        annotation_level: "notice" as const,
        title: `AI-written code: ${percent(f.aiTokens, f.addedTokens)} of this file's changes`,
        message: `Lines ${lineRanges(lines)} · ${models.join(", ")}` + (runUrl ? `\nDetails: ${runUrl}` : ""),
      };
    });
}

export function stepSummary(data: ReportData): string {
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
  lines.push(`The full report with the highlighted code is in the **goairside-report** artifact below.`, ``);
  return lines.join("\n");
}
