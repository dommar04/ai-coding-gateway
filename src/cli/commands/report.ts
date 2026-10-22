import { parseArgs } from "../helper/args";

// report: the AI change report of a merge request or push (in CI), or of the current branch (locally).

export async function runReport(args: string[]): Promise<void> {
  const { flags } = parseArgs(args);
  const text = (name: string) => (typeof flags[name] === "string" ? (flags[name] as string) : undefined);

  // Loaded lazily so the hooks never pay for the report code.
  const { runReport: report, runCodeQualityReport } = await import("../../services/report/handler");
  const { gitLabBranchPipeline } = await import("../../services/report/gitlab/gitlab");
  if (gitLabBranchPipeline()) {
    // No merge request to report on: only the AI code at this commit, for merge requests into this branch.
    console.log(`goAirside Code Quality report: ${runCodeQualityReport({ head: text("head"), out: text("out") })}`);
    return;
  }
  const { file, data } = await report({ base: text("base"), head: text("head"), out: text("out") });

  for (const warning of data.warnings) console.error(`Warning: ${warning}`);
  const added = data.files.reduce((n, f) => n + f.addedTokens, 0);
  const ai = data.files.reduce((n, f) => n + f.aiTokens, 0);
  const share = added ? Math.round((ai / added) * 100) : 0;
  console.log(`goAirside report for ${data.subject}
  AI share:       ${share}% (${ai} of ${added} new tokens)
  Files with AI:  ${data.files.filter((f) => f.aiTokens).length} of ${data.files.length}
  Sessions:       ${data.sessions}
  Report:         ${file}`);
}
