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
      const ci = join(repo, ".gitlab-ci.yml");
      const stage = gitLabStage(readFileSync(ci, "utf8"));
      writeTemplate("gitlab-pipeline-template.yml", join(repo, GITLAB_JOB), (t) => t.replace("stage: test", `stage: ${stage}`));
      addGitLabInclude(ci);
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
function writeTemplate(template: string, target: string, edit = (text: string) => text): void {
  if (existsSync(target)) return;
  const text = edit(
    readFileSync(packageFile("pipeline", template), "utf8").replace(
      "apichap-ai-coding-gateway@latest",
      `apichap-ai-coding-gateway@${packageVersion()}`
    )
  );
  mkdirSync(dirname(target), { recursive: true });
  // "wx": a parallel hook call may have written it first.
  writeFileSync(target, text, { flag: "wx" });
}

/**
 * A stage the GitLab project has, for the job: "test" (a default stage) unless `stages:` lists others, then
 * its first one. Not .pre or .post: GitLab doesn't run a pipeline that has only jobs in those.
 * shortcut: reads `stages:` in .gitlab-ci.yml only, not in included files; then the stage is set by hand.
 */
export function gitLabStage(ci: string): string {
  const block = /^stages:[ \t]*(?:\[(.*)\]|\n((?:[ \t]*(?:-.*|#.*)?(?:\n|$))*))/m.exec(lf(ci));
  if (!block) return "test";
  const items =
    block[1] !== undefined ? block[1].split(",") : (block[2].match(/^[ \t]*-.*$/gm) ?? []).map((l) => l.replace(/^[ \t]*-/, ""));
  const stages = items
    .map((s) =>
      s
        .replace(/#.*/, "")
        .trim()
        .replace(/^["']|["']$/g, "")
    )
    .filter((s) => s && s !== ".pre" && s !== ".post");
  return !stages.length || stages.includes("test") ? "test" : stages[0];
}

/**
 * Includes the job file in .gitlab-ci.yml: a new `include:` list, or one more item in an existing list.
 * Other `include:` forms (a single file, a map) are left alone, with a note in the error log.
 */
export function addGitLabInclude(file: string): void {
  const raw = readFileSync(file, "utf8");
  if (raw.includes(GITLAB_JOB)) return;
  const text = lf(raw);
  // Written back with the file's own line endings and byte order mark.
  const save = (t: string) =>
    writeFileSync(file, (raw.startsWith("﻿") ? "﻿" : "") + (raw.includes("\r\n") ? t.replace(/\n/g, "\r\n") : t));
  const include = /^include:[ \t]*(\S.*)?$/m.exec(text);
  if (!include) {
    save(`${text}${text.endsWith("\n") || !text ? "" : "\n"}\ninclude:\n  - local: ${GITLAB_JOB}\n`);
    return;
  }
  const after = text.slice(include.index + include[0].length);
  const item = /^\n(?:[ \t]*(?:#.*)?\n)*([ \t]*)- /.exec(after);
  if (include[1] || !item) {
    logError("pipeline setup: GitLab CI", `${file}: add "- local: ${GITLAB_JOB}" to its include: by hand.`);
    return;
  }
  const at = include.index + include[0].length;
  save(`${text.slice(0, at)}\n${item[1]}- local: ${GITLAB_JOB}${text.slice(at)}`);
}

/** The YAML with "\n" line endings and no byte order mark, as the patterns above expect (Windows files have "\r\n"). */
function lf(yaml: string): string {
  return yaml.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}
