import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TraceFile } from "../src/services/trace/helper/trace-file";
import { addGitLabInclude, gitLabStage } from "../src/services/pipeline/pipelines";
import { packageVersion } from "../src/integrations/shared/settings";

const root = mkdtempSync(join(tmpdir(), "apichap-pipeline-"));
after(() => rmSync(root, { recursive: true, force: true }));

const SESSION = { id: "1a2b3c4d-0000-0000-0000-000000000000", agent: "claude" };
const trace = (project: string) => new TraceFile(project, SESSION).addChange({ tool: "Write", path: "a.ts", seg: ["AAE="] });

/** A repository folder with the given files. */
function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(root, "repo-"));
  mkdirSync(join(dir, ".git"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

test("pipeline: the first trace adds the report to every CI the repository uses, with this version", () => {
  const dir = repo({ ".github/workflows/ci.yml": "name: ci\n", ".gitlab-ci.yml": "test:\n  script: [npm test]\n" });
  // The project can be a subfolder: the pipeline files are at the repository's root.
  trace(join(dir, "app"));
  const workflow = readFileSync(join(dir, ".github/workflows/goairside-report.yml"), "utf8");
  assert.match(workflow, new RegExp(`npx -y apichap-ai-coding-gateway@${packageVersion().replace(/\./g, "\\.")} report`));
  assert.match(readFileSync(join(dir, ".gitlab/goairside-report.yml"), "utf8"), /^goairside-report:/m);
  assert.equal(
    readFileSync(join(dir, ".gitlab-ci.yml"), "utf8"),
    "test:\n  script: [npm test]\n\ninclude:\n  - local: .gitlab/goairside-report.yml\n"
  );
});

test("pipeline: only once, and never over the user's files", () => {
  const dir = repo({ ".github/workflows/goairside-report.yml": "mine\n" });
  trace(dir);
  assert.equal(readFileSync(join(dir, ".github/workflows/goairside-report.yml"), "utf8"), "mine\n");

  // .goairside exists: later traces leave the pipelines alone, even ones the user removed.
  rmSync(join(dir, ".github"), { recursive: true });
  mkdirSync(join(dir, ".github/workflows"), { recursive: true });
  new TraceFile(dir, { ...SESSION, id: "9f8e7d6c-0000-0000-0000-000000000000" }).addChange({
    tool: "Write",
    path: "a.ts",
    seg: ["AAE="],
  });
  assert.equal(existsSync(join(dir, ".github/workflows/goairside-report.yml")), false);
});

test("pipeline: nothing without CI files, and nothing outside a repository", () => {
  const dir = repo({ ".github/dependabot.yml": "version: 2\n" });
  trace(dir);
  assert.equal(existsSync(join(dir, ".github/workflows")), false);
  assert.equal(existsSync(join(dir, ".gitlab")), false);

  const plain = mkdtempSync(join(root, "plain-"));
  writeFileSync(join(plain, ".gitlab-ci.yml"), "test:\n  script: [npm test]\n");
  trace(plain);
  assert.equal(existsSync(join(plain, ".gitlab")), false);
});

test("pipeline: the GitLab job gets a stage the project has", () => {
  assert.equal(gitLabStage("build:\n  script: [make]\n"), "test");
  assert.equal(gitLabStage("stages:\n  - build\n  - test\n"), "test");
  assert.equal(
    gitLabStage("stages:\n  - .pre\n  # first\n  - pre-build\n  - build\n  - deploy\n\njob:\n  script: [x]\n"),
    "pre-build"
  );
  assert.equal(gitLabStage('stages: [".pre", build, deploy]\n'), "build");
  // Files saved on Windows: "\r\n" and a byte order mark.
  assert.equal(gitLabStage("﻿stages:\r\n  - pre-build\r\n  - build\r\n  - deploy\r\n"), "pre-build");

  const dir = repo({ ".gitlab-ci.yml": "stages:\r\n  - build\r\n  - deploy\r\n" });
  trace(dir);
  assert.match(readFileSync(join(dir, ".gitlab/goairside-report.yml"), "utf8"), /^  stage: build$/m);
  assert.equal(
    readFileSync(join(dir, ".gitlab-ci.yml"), "utf8"),
    "stages:\r\n  - build\r\n  - deploy\r\n\r\ninclude:\r\n  - local: .gitlab/goairside-report.yml\r\n"
  );
});

test("pipeline: the GitLab include joins an existing include list, once; other forms are left alone", () => {
  const dir = repo({});
  const ci = (text: string) => {
    writeFileSync(join(dir, ".gitlab-ci.yml"), text);
    addGitLabInclude(join(dir, ".gitlab-ci.yml"));
    addGitLabInclude(join(dir, ".gitlab-ci.yml"));
    return readFileSync(join(dir, ".gitlab-ci.yml"), "utf8");
  };
  assert.equal(
    ci("include:\n  # shared\n  - project: org/ci\n    file: base.yml\nbuild:\n  script: [make]\n"),
    "include:\n  - local: .gitlab/goairside-report.yml\n  # shared\n  - project: org/ci\n    file: base.yml\nbuild:\n  script: [make]\n"
  );
  assert.equal(
    ci("include:\r\n  - local: base.yml\r\n"),
    "include:\r\n  - local: .gitlab/goairside-report.yml\r\n  - local: base.yml\r\n"
  );
  assert.equal(ci("include: base.yml\n"), "include: base.yml\n");
  assert.equal(ci("include:\n  local: base.yml\n"), "include:\n  local: base.yml\n");
});
