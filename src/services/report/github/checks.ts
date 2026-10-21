// The report's only network access: a check run on GitHub (the platform that already hosts the code).
// It goes to GITHUB_API_URL (api.github.com or your GitHub Enterprise) with the job's GITHUB_TOKEN,
// which only works for this repository and expires with the job. It sends titles, paths, line numbers,
// percentages and model names; no code.

/** GitHub accepts at most 50 annotations per request; more are added with further requests. */
const ANNOTATIONS_PER_REQUEST = 50;

export interface CheckAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: "notice";
  title: string;
  message: string;
}

export interface Check {
  /** The commit the check belongs to: the pull request's head, so GitHub shows it there. */
  headSha: string;
  title: string;
  /** Markdown shown on the check's page. */
  summary: string;
  detailsUrl?: string;
  annotations: CheckAnnotation[];
}

/** Creates the check. Returns "created", or why it was skipped (no token, no permission, ...). */
export async function createCheck(check: Check, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const api = env.GITHUB_API_URL;
  const repo = env.GITHUB_REPOSITORY;
  const token = env.GITHUB_TOKEN;
  if (!api || !repo) return "not running in GitHub Actions";
  if (!token) return "no GITHUB_TOKEN (pass it to the step: env: GITHUB_TOKEN: ${{ github.token }})";

  const request = async (method: "POST" | "PATCH", path: string, body: unknown) => {
    const res = await fetch(`${api}/repos/${repo}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new HttpError(res.status, await res.text());
    return (await res.json()) as { id: number };
  };

  const batches: CheckAnnotation[][] = [];
  for (let i = 0; i < check.annotations.length; i += ANNOTATIONS_PER_REQUEST)
    batches.push(check.annotations.slice(i, i + ANNOTATIONS_PER_REQUEST));
  const output = (annotations: CheckAnnotation[]) => ({ title: check.title, summary: check.summary, annotations });

  try {
    const { id } = await request("POST", "/check-runs", {
      name: "goAirside",
      head_sha: check.headSha,
      status: "completed",
      conclusion: "neutral",
      ...(check.detailsUrl ? { details_url: check.detailsUrl } : {}),
      output: output(batches[0] ?? []),
    });
    // Each update adds its annotations to the ones already there.
    for (const batch of batches.slice(1)) await request("PATCH", `/check-runs/${id}`, { output: output(batch) });
    return "created";
  } catch (err) {
    if (err instanceof HttpError && err.status === 403)
      return "no permission to create checks (add `checks: write` to the workflow's permissions)";
    return `GitHub API error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    body: string
  ) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`);
  }
}
