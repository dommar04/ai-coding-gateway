import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AiSpan } from "../helper/matcher";
import type { TracedChange } from "../helper/traces";
import { lineRanges } from "../helper/lines";

// The report inside GitLab: a Code Quality report (CodeClimate JSON) that the merge request widget and
// the "Changes" tab show. The job declares it as an artifact:
//   artifacts: { reports: { codequality: goairside-report/gl-code-quality.json } }
// GitLab shows a merge request only the findings that are new compared with its target branch's report,
// and nothing without one. So every pipeline, merge request or branch, reports every recorded AI change at
// its commit, and GitLab works out which ones a merge request adds. The fingerprint (how GitLab tells two
// findings are the same) is the change itself: traces are append-only, so it never changes. The line only
// places the marker: where the change's code is now, or line 1 once a human rewrote it.

export const CODE_QUALITY_FILE = "gl-code-quality.json";

export interface CodeQualityFinding {
  description: string;
  check_name: string;
  fingerprint: string;
  severity: "info";
  location: { path: string; lines: { begin: number } };
}

/** A file that exists at the commit: the AI changes recorded for it, and the spans of them found in it. */
export interface AiFile {
  path: string;
  changes: TracedChange[];
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

/** One finding per recorded change, on its first line still found. */
export function codeQualityFindings(files: AiFile[]): CodeQualityFinding[] {
  return files.flatMap((f) =>
    f.changes.map((change) => {
      const lines = [...new Set(f.spans.filter((s) => s.change === change).map((s) => s.line))].sort((a, b) => a - b);
      const where = lines.length ? `${lines.length > 1 ? "lines" : "line"} ${lineRanges(lines)}` : "code changed since";
      const id = JSON.stringify([change.session, change.at, change.path, change.tool, change.segments]);
      return {
        description: `AI-generated code: ${where} · ${change.model ?? "unknown model"}`,
        check_name: "goairside-ai-code",
        fingerprint: createHash("sha256").update(id).digest("hex"),
        severity: "info" as const,
        location: { path: f.path, lines: { begin: lines[0] ?? 1 } },
      };
    })
  );
}
