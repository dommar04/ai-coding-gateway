import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { logError } from "../../helpers/errors";
import { packageFile } from "../../helpers/paths";
import { packageVersion } from "../../integrations/shared/settings";

// Sets up the AI change report in the repository's CI, once: when a project gets its .goairside folder.
// Only for the CI systems the repository already uses (their pipeline files exist), and never over a file
// that is already there, so whatever the user changes later stays. Templates: pipeline/ in this package.
// To support another CI, add it to CI_SETUPS.

const GITLAB_JOB = ".gitlab/goairside-report.yml";

interface CiSetup {
  name: string;
  /** Whether the repository uses this CI. */
  uses(repo: string): boolean;
  setUp(repo: string): void;
}

const CI_SETUPS: CiSetup[] = [
  {
    name: "GitHub Actions",
    uses: (repo) => existsSync(join(repo, ".github", "workflows")),
    setUp: (repo) => writeTemplate("github-pipeline-template.yml", join(repo, ".github", "workflows", "goairside-report.yml")),
  },
  {
    name: "GitLab CI",
    uses: (repo) => existsSync(join(repo, ".gitlab-ci.yml")),
    setUp(repo) {
      writeTemplate("gitlab-pipeline-template.yml", join(repo, GITLAB_JOB));
      addGitLabInclude(join(repo, ".gitlab-ci.yml"));
    },
  },
];

/**
 * Adds the report to every CI the repository holding `projectRoot` uses, and returns their names.
 * Never throws: it runs in a hook.
 */
export function setUpPipelines(projectRoot: string): string[] {
  const repo = repoRoot(projectRoot);
  if (!repo) return [];
  const done: string[] = [];
  for (const ci of CI_SETUPS) {
    try {
      if (!ci.uses(repo)) continue;
      ci.setUp(repo);
      done.push(ci.name);
    } catch (err) {
      logError(`pipeline setup: ${ci.name}`, err);
    }
  }
  return done;
}

/** The folder holding .git, from `dir` upwards. */
function repoRoot(dir: string): string | null {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) return d;
    if (dirname(d) === d) return null;
  }
}

/** Writes a template with this package's version, unless the file exists. */
function writeTemplate(template: string, target: string): void {
  if (existsSync(target)) return;
  const text = readFileSync(packageFile("pipeline", template), "utf8").replace(
    "apichap-ai-coding-gateway@latest",
    `apichap-ai-coding-gateway@${packageVersion()}`
  );
  mkdirSync(dirname(target), { recursive: true });
  // "wx": a parallel hook call may have written it first.
  writeFileSync(target, text, { flag: "wx" });
}

/**
 * Includes the job file in .gitlab-ci.yml: a new `include:` list, or one more item in an existing list.
 * Other `include:` forms (a single file, a map) are left alone, with a note in the error log.
 */
export function addGitLabInclude(file: string): void {
  const text = readFileSync(file, "utf8");
  if (text.includes(GITLAB_JOB)) return;
  const include = /^include:[ \t]*(\S.*)?$/m.exec(text);
  if (!include) {
    writeFileSync(file, `${text}${text.endsWith("\n") || !text ? "" : "\n"}\ninclude:\n  - local: ${GITLAB_JOB}\n`);
    return;
  }
  const after = text.slice(include.index + include[0].length);
  const item = /^\n(?:[ \t]*(?:#.*)?\n)*([ \t]*)- /.exec(after);
  if (include[1] || !item) {
    logError("pipeline setup: GitLab CI", `${file}: add "- local: ${GITLAB_JOB}" to its include: by hand.`);
    return;
  }
  const at = include.index + include[0].length;
  writeFileSync(file, `${text.slice(0, at)}\n${item[1]}- local: ${GITLAB_JOB}${text.slice(at)}`);
}
