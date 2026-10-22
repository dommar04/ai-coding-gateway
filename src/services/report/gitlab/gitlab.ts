import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AiSpan } from "../helper/matcher";
import { lineBlocks } from "../helper/lines";

// The report inside GitLab: a Code Quality report (CodeClimate JSON) that the merge request widget and
// the "Changes" tab show. The job declares it as an artifact:
//   artifacts: { reports: { codequality: goairside-report/gl-code-quality.json } }
// GitLab shows a merge request only the findings that are new compared with its target branch's report,
// and nothing without one. So every pipeline, merge request or branch, reports all AI code at its commit,
// and GitLab works out what a merge request adds. The fingerprint is how GitLab tells two findings are the
// same: it is the block's code, so AI code that moved down a few lines is still the same finding.

export const CODE_QUALITY_FILE = "gl-code-quality.json";

export interface CodeQualityFinding {
  description: string;
  check_name: string;
  fingerprint: string;
  severity: "info";
  location: { path: string; lines: { begin: number } };
}

/** A file's AI code: its content at the commit and the spans matched in it. */
export interface AiFile {
  path: string;
  content: string;
  spans: AiSpan[];
}

/** Whether this is a GitLab CI pipeline for a branch, not a merge request: it only needs the Code Quality report. */
export function gitLabBranchPipeline(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GITLAB_CI === "true" && env.CI_PIPELINE_SOURCE !== "merge_request_event";
}

/** Writes the Code Quality report into `outDir` and returns its path. */
export function writeCodeQuality(files: AiFile[], outDir: string): string {
  const file = join(outDir, CODE_QUALITY_FILE);
  writeFileSync(file, JSON.stringify(codeQualityFindings(files), null, 2));
  return file;
}

/** One finding per block of consecutive AI lines, on its first line. */
export function codeQualityFindings(files: AiFile[]): CodeQualityFinding[] {
  return files.flatMap((f) => {
    const lines = [...new Set(f.spans.map((s) => s.line))].sort((a, b) => a - b);
    const text = f.content.split("\n");
    const seen = new Map<string, number>();
    return lineBlocks(lines).map(([begin, end]) => {
      const models = [
        ...new Set(f.spans.filter((s) => s.line >= begin && s.line <= end).map((s) => s.change.model ?? "unknown model")),
      ];
      const code = text.slice(begin - 1, end).join("\n");
      // The same code twice in a file still needs two fingerprints.
      const copy = (seen.get(code) ?? 0) + 1;
      seen.set(code, copy);
      return {
        description: `AI-generated code: ${begin === end ? `line ${begin}` : `lines ${begin}–${end}`} · ${models.join(", ")}`,
        check_name: "goairside-ai-code",
        fingerprint: createHash("sha256").update(`${f.path}\n${copy}\n${code}`).digest("hex"),
        severity: "info" as const,
        location: { path: f.path, lines: { begin } },
      };
    });
  });
}
