import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReportFile } from "../html/html";
import { lineBlocks } from "../helper/lines";

// The report inside GitLab: a Code Quality report (CodeClimate JSON) that the merge request widget and
// the "Changes" tab show. The job declares it as an artifact:
//   artifacts: { reports: { codequality: goairside-report/gl-code-quality.json } }

export const CODE_QUALITY_FILE = "gl-code-quality.json";

export interface CodeQualityFinding {
  description: string;
  check_name: string;
  fingerprint: string;
  severity: "info";
  location: { path: string; lines: { begin: number } };
}

/** Writes the Code Quality report into `outDir`, when running in GitLab CI. */
export function writeGitLabOutput(files: ReportFile[], outDir: string, env: NodeJS.ProcessEnv = process.env): void {
  if (env.GITLAB_CI !== "true") return;
  writeFileSync(join(outDir, CODE_QUALITY_FILE), JSON.stringify(codeQualityFindings(files), null, 2));
}

/** One finding per block of consecutive AI lines, on its first line. */
export function codeQualityFindings(files: ReportFile[]): CodeQualityFinding[] {
  return files.flatMap((f) => {
    const lines = [...new Set(f.spans.map((s) => s.line))].sort((a, b) => a - b);
    return lineBlocks(lines).map(([begin, end]) => {
      const models = [
        ...new Set(f.spans.filter((s) => s.line >= begin && s.line <= end).map((s) => s.change.model ?? "unknown model")),
      ];
      return {
        description: `AI-generated code: ${begin === end ? `line ${begin}` : `lines ${begin}–${end}`} · ${models.join(", ")}`,
        check_name: "goairside-ai-code",
        // shortcut: changes when lines above the block move, so GitLab then shows it as resolved + new; hash the block's code if that matters.
        fingerprint: createHash("sha256").update(`${f.path}:${begin}-${end}`).digest("hex"),
        severity: "info" as const,
        location: { path: f.path, lines: { begin } },
      };
    });
  });
}
