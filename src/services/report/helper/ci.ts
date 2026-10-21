import { readFileSync } from "node:fs";
import type { Range } from "./git";

// Which commits a CI run is about. Every CI names them, each in its own variables:
//   merge request:  the target branch's commit ... the request's commit  (like the "Changes" tab)
//   push:           the commit before the push .. the pushed commit
//   new branch:     the default branch ... the pushed commit
// Outside CI (a local run), the current commit is compared with the repository's default branch.
// To support another CI, add a function to CI_SYSTEMS.

const NO_COMMIT = /^0+$/;

type Env = Record<string, string | undefined>;

interface CiSystem {
  name: string;
  /** Whether this run is on that CI. */
  detect(env: Env): boolean;
  range(env: Env): Range | null;
}

const github: CiSystem = {
  name: "GitHub Actions",
  detect: (env) => env.GITHUB_ACTIONS === "true",
  range(env) {
    const event = readJson(env.GITHUB_EVENT_PATH) as GitHubEvent | null;
    const pr = event?.pull_request;
    if (pr) {
      const label = pr.head.ref && pr.base.ref ? `${pr.head.ref} → ${pr.base.ref} · #${pr.number}` : undefined;
      return withLabel({ base: pr.base.sha, head: pr.head.sha, dots: "..." }, label);
    }
    if (event?.before && event.after)
      return withLabel(
        pushRange(event.before, event.after, event.repository?.default_branch),
        env.GITHUB_REF_NAME && `push to ${env.GITHUB_REF_NAME}`
      );
    return null;
  },
};

interface GitHubEvent {
  pull_request?: { number?: number; base: { sha: string; ref?: string }; head: { sha: string; ref?: string } };
  before?: string;
  after?: string;
  repository?: { default_branch?: string };
}

const gitlab: CiSystem = {
  name: "GitLab CI",
  detect: (env) => env.GITLAB_CI === "true",
  range(env) {
    const head = env.CI_COMMIT_SHA;
    if (!head) return null;
    // Merge request pipelines name the base directly; merged-results pipelines run on a merge commit, but
    // CI_MERGE_REQUEST_SOURCE_BRANCH_SHA is the request's own commit then.
    if (env.CI_MERGE_REQUEST_DIFF_BASE_SHA) {
      const source = env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME;
      const target = env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME;
      return withLabel(
        { base: env.CI_MERGE_REQUEST_DIFF_BASE_SHA, head: env.CI_MERGE_REQUEST_SOURCE_BRANCH_SHA || head, dots: "..." },
        source && target ? `${source} → ${target} · !${env.CI_MERGE_REQUEST_IID}` : undefined
      );
    }
    if (env.CI_COMMIT_BEFORE_SHA)
      return withLabel(
        pushRange(env.CI_COMMIT_BEFORE_SHA, head, env.CI_DEFAULT_BRANCH),
        env.CI_COMMIT_REF_NAME && `push to ${env.CI_COMMIT_REF_NAME}`
      );
    return null;
  },
};

const CI_SYSTEMS: CiSystem[] = [github, gitlab];

/**
 * The range to report on: --base (and --head) when given, else the CI's merge request or push, else
 * (a local run) HEAD against `localBase()`, the repository's default branch.
 */
export function resolveRange(
  options: { base?: string; head?: string },
  env: Env = process.env,
  localBase: () => string | null = () => null
): Range {
  if (options.base) return local(options.base, options.head);
  const ci = CI_SYSTEMS.find((c) => c.detect(env));
  if (ci) {
    const range = ci.range(env);
    if (range) return range;
    throw new Error(`${ci.name}: this run is neither a merge request nor a push. Pass --base <branch or commit>.`);
  }
  const base = localBase();
  if (base) return local(base, options.head);
  throw new Error("Could not find the default branch to compare with. Pass --base <branch or commit>.");
}

function local(base: string, head = "HEAD"): Range {
  return { base, head, dots: "...", label: `${head} → ${base}` };
}

function withLabel(range: Range | null, label: string | undefined): Range | null {
  return range && label ? { ...range, label } : range;
}

/** A push: what it added to the branch, or for a new branch, what it has that the default branch doesn't. */
function pushRange(before: string, after: string, defaultBranch: string | undefined): Range | null {
  if (!NO_COMMIT.test(before)) return { base: before, head: after, dots: ".." };
  return defaultBranch ? { base: `origin/${defaultBranch}`, head: after, dots: "..." } : null;
}

function readJson(path: string | undefined): unknown {
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
