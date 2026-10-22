import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkHistory, fileAtHead, newTraceFiles, parseDiff, rangeDiff } from "../src/services/report/helper/git";
import { resolveRange } from "../src/services/report/helper/ci";
import { readTrace, type TracedChange } from "../src/services/report/helper/traces";
import { matchFile, type AiSpan } from "../src/services/report/helper/matcher";
import { encodeSegment, hashToken, tokenize } from "../src/services/trace/helper/hasher";
import { renderReport, type ReportFile } from "../src/services/report/html/html";
import { runReport } from "../src/services/report/handler";
import { fileAnnotations, stepSummary, writeGitHubOutput } from "../src/services/report/github/github";
import { lineRanges } from "../src/services/report/helper/lines";
import { CODE_QUALITY_FILE, codeQualityFindings, writeGitLabOutput } from "../src/services/report/gitlab/gitlab";
import { createCheck } from "../src/services/report/github/checks";

const root = mkdtempSync(join(tmpdir(), "apichap-report-"));
after(() => rmSync(root, { recursive: true, force: true }));

const SESSION_LINE = JSON.stringify({
  kind: "session",
  format: "goairside-trace",
  v: 1,
  tokenizer: 1,
  session: "s1",
  agent: "claude",
  gateway: "1.0.1",
  started: "2026-10-21T09:00:00.000Z",
});
const changeLine = (path: string, text: string) =>
  JSON.stringify({
    kind: "change",
    t: "2026-10-21T09:01:00.000Z",
    model: "m1",
    tool: "Edit",
    path,
    seg: [encodeSegment(tokenize(text))],
  });

// A repository with a main branch and a feature branch that changes, adds, renames and deletes files.
function makeRepo(): string {
  const dir = mkdtempSync(join(root, "repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", ...args], {
      cwd: dir,
      encoding: "utf8",
    });
  const write = (path: string, text: string) => {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  git("init", "-q", "-b", "main");
  write("a.ts", "one\ntwo\nthree\n");
  write("gone.ts", "bye\n");
  write("old-name.ts", "keep\nthese\nlines\nhere\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  git("checkout", "-q", "-b", "feature");
  write("a.ts", "one\nTWO\nthree\nfour\n");
  write("b.ts", "new file\n");
  git("rm", "-q", "gone.ts");
  git("mv", "old-name.ts", "new-name.ts");
  write(".goairside/traces/2026-10-21T09-00-00Z_s1.jsonl", SESSION_LINE + "\n" + changeLine("b.ts", "new file") + "\n");
  write("pkg/.goairside/traces/2026-10-21T09-00-00Z_s2.jsonl", SESSION_LINE + "\n");
  git("add", ".");
  git("commit", "-q", "-m", "feature");
  return dir;
}

test("git: the range's new trace files, also in subfolders", () => {
  const dir = makeRepo();
  assert.deepEqual(newTraceFiles({ base: "main", head: "feature", dots: "..." }, dir).sort(), [
    ".goairside/traces/2026-10-21T09-00-00Z_s1.jsonl",
    "pkg/.goairside/traces/2026-10-21T09-00-00Z_s2.jsonl",
  ]);
});

test("git: the diff has changed, added and renamed files, without deleted files and traces", () => {
  const dir = makeRepo();
  const files = rangeDiff({ base: "main", head: "feature", dots: "..." }, dir);
  assert.deepEqual(
    files.map((f) => [f.path, f.status]),
    [
      ["a.ts", "modified"],
      ["b.ts", "added"],
    ]
  );
  // A pure rename has no hunks, so it is not part of the diff.
  const [a] = files;
  assert.deepEqual(
    a.hunks[0].lines.map((l) => [l.type, l.text, l.oldLine, l.newLine]),
    [
      ["context", "one", 1, 1],
      ["del", "two", 2, undefined],
      ["add", "TWO", undefined, 2],
      ["context", "three", 3, 3],
      ["add", "four", undefined, 4],
    ]
  );
  assert.equal(fileAtHead({ base: "main", head: "feature", dots: "..." }, "a.ts", dir), "one\nTWO\nthree\nfour\n");
});

test("git: a missing commit gives a clear message", () => {
  const dir = makeRepo();
  assert.doesNotThrow(() => checkHistory({ base: "main", head: "feature", dots: "..." }, dir));
  assert.throws(() => checkHistory({ base: "0123abc", head: "feature", dots: "..." }, dir), /full history/);
});

test("git: renames with changes and quoted paths are parsed", () => {
  const [file] = parseDiff(
    [
      'diff --git "a/old \\"x\\".ts" "b/new \\"x\\".ts"',
      "similarity index 80%",
      'rename from old "x".ts',
      'rename to new "x".ts',
      '--- "a/old \\"x\\".ts"',
      '+++ "b/new \\"x\\".ts"',
      "@@ -1,2 +1,2 @@",
      " a",
      "-b",
      "+c",
      "\\ No newline at end of file",
    ].join("\n")
  );
  assert.deepEqual(
    [file.path, file.oldPath, file.status, file.hunks[0].lines.length],
    ['new "x".ts', 'old "x".ts', "renamed", 3]
  );
});

// CI ranges

test("ci: an explicit base wins", () => {
  assert.deepEqual(resolveRange({ base: "develop" }, { GITHUB_ACTIONS: "true" }), {
    base: "develop",
    head: "HEAD",
    dots: "...",
    label: "HEAD → develop",
  });
});

test("ci: a local run compares with the default branch", () => {
  assert.deepEqual(
    resolveRange({}, {}, () => "origin/main"),
    { base: "origin/main", head: "HEAD", dots: "...", label: "HEAD → origin/main" }
  );
  assert.throws(() => resolveRange({}, {}, () => null), /default branch.*--base/);
});

test("ci: merge requests and pushes get a readable label", () => {
  const path = join(mkdtempSync(join(root, "event-")), "event.json");
  writeFileSync(
    path,
    JSON.stringify({ pull_request: { number: 42, base: { sha: "b", ref: "main" }, head: { sha: "h", ref: "feature/login" } } })
  );
  assert.equal(resolveRange({}, { GITHUB_ACTIONS: "true", GITHUB_EVENT_PATH: path }).label, "feature/login → main · #42");
  const gitlab = resolveRange(
    {},
    {
      GITLAB_CI: "true",
      CI_COMMIT_SHA: "h",
      CI_MERGE_REQUEST_DIFF_BASE_SHA: "b",
      CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: "feature/login",
      CI_MERGE_REQUEST_TARGET_BRANCH_NAME: "main",
      CI_MERGE_REQUEST_IID: "7",
    }
  );
  assert.equal(gitlab.label, "feature/login → main · !7");
  assert.equal(
    resolveRange({}, { GITLAB_CI: "true", CI_COMMIT_SHA: "h", CI_COMMIT_BEFORE_SHA: "b", CI_COMMIT_REF_NAME: "main" }).label,
    "push to main"
  );
});

test("ci: GitHub pull requests, pushes and new branches", () => {
  const event = (o: unknown) => {
    const path = join(mkdtempSync(join(root, "event-")), "event.json");
    writeFileSync(path, JSON.stringify(o));
    return { GITHUB_ACTIONS: "true", GITHUB_EVENT_PATH: path };
  };
  assert.deepEqual(resolveRange({}, event({ pull_request: { base: { sha: "b1" }, head: { sha: "h1" } } })), {
    base: "b1",
    head: "h1",
    dots: "...",
  });
  assert.deepEqual(resolveRange({}, event({ before: "b2", after: "h2" })), { base: "b2", head: "h2", dots: ".." });
  assert.deepEqual(resolveRange({}, event({ before: "0".repeat(40), after: "h3", repository: { default_branch: "main" } })), {
    base: "origin/main",
    head: "h3",
    dots: "...",
  });
  assert.throws(() => resolveRange({}, event({ action: "opened" })), /GitHub Actions: .*--base/);
});

test("ci: GitLab merge requests, merged results and pushes", () => {
  const gl = (vars: Record<string, string>) => ({ GITLAB_CI: "true", CI_COMMIT_SHA: "h1", ...vars });
  assert.deepEqual(resolveRange({}, gl({ CI_MERGE_REQUEST_DIFF_BASE_SHA: "b1" })), { base: "b1", head: "h1", dots: "..." });
  assert.deepEqual(resolveRange({}, gl({ CI_MERGE_REQUEST_DIFF_BASE_SHA: "b1", CI_MERGE_REQUEST_SOURCE_BRANCH_SHA: "src" })), {
    base: "b1",
    head: "src",
    dots: "...",
  });
  assert.deepEqual(resolveRange({}, gl({ CI_COMMIT_BEFORE_SHA: "b2" })), { base: "b2", head: "h1", dots: ".." });
  assert.deepEqual(resolveRange({}, gl({ CI_COMMIT_BEFORE_SHA: "0".repeat(40), CI_DEFAULT_BRANCH: "main" })), {
    base: "origin/main",
    head: "h1",
    dots: "...",
  });
});

test("ci: a supported CI run that is neither a merge request nor a push needs --base", () => {
  assert.throws(() => resolveRange({}, { GITLAB_CI: "true" }, () => "main"), /GitLab CI: .*--base/);
});

// Reading traces

test("traces: changes with decoded segments; paths relative to the project folder", () => {
  const text = SESSION_LINE + "\n" + changeLine("src/a.ts", "const a = 1;") + "\n";
  const root = readTrace(".goairside/traces/x.jsonl", text);
  assert.deepEqual(root.warnings, []);
  assert.deepEqual(root.changes, [
    {
      path: "src/a.ts",
      tool: "Edit",
      model: "m1",
      at: "2026-10-21T09:01:00.000Z",
      agent: "claude",
      session: "s1",
      segments: [tokenize("const a = 1;").map(hashToken)],
    },
  ]);
  assert.equal(readTrace("pkg/web/.goairside/traces/x.jsonl", text).changes[0].path, "pkg/web/src/a.ts");
});

test("traces: unknown lines are skipped, unknown versions and other files with a warning", () => {
  const text = [SESSION_LINE, '{"kind":"rename","from":"a","to":"b"}', "not json", changeLine("a.ts", "x y")].join("\n");
  assert.equal(readTrace(".goairside/traces/x.jsonl", text).changes.length, 1);

  const v2 = SESSION_LINE.replace('"v":1', '"v":2');
  const skipped = readTrace(".goairside/traces/x.jsonl", v2 + "\n" + changeLine("a.ts", "x"));
  assert.deepEqual(skipped.changes, []);
  assert.match(skipped.warnings[0], /format 2 .* not supported/);
  assert.match(readTrace(".goairside/traces/x.jsonl", '{"hello":1}').warnings[0], /not a goairside trace/);
});

// Matching

const traced = (texts: string[], at = "2026-10-21T09:01:00.000Z", model = "m1"): TracedChange => ({
  path: "a.ts",
  tool: "Edit",
  model,
  at,
  agent: "claude",
  session: "s1",
  segments: texts.map((t) => tokenize(t).map(hashToken)),
});
const allLines = (content: string) => new Set(content.split("\n").map((_, i) => i + 1));
/** The highlighted text per line: "line: text". */
const highlighted = (content: string, spans: AiSpan[]) =>
  spans.map((s) => `${s.line}: ${content.split("\n")[s.line - 1].slice(s.start, s.end)}`);

const REDUCE = "const total = items.reduce((a, b) => a + b, 0);";

test("matcher: recorded code is highlighted, from its first to its last token", () => {
  const content = `// header\n${REDUCE}\n`;
  const m = matchFile(content, allLines(content), [traced([REDUCE])]);
  assert.deepEqual(highlighted(content, m.spans), [`2: ${REDUCE}`]);
  assert.deepEqual([m.addedTokens, m.aiTokens, m.missing.length], [3 + 21, 21, 0]);
});

test("matcher: a word a human changed breaks the run; short leftovers are not marked", () => {
  const content = "const total = items.reduce((a, b) => a + b, 1);\n";
  const m = matchFile(content, allLines(content), [traced([REDUCE])]);
  // 18 tokens up to "b ,", then "1" was changed; ") ;" alone is shorter than 8 tokens.
  assert.deepEqual(highlighted(content, m.spans), ["1: const total = items.reduce((a, b) => a + b,"]);
  assert.equal(m.aiTokens, 18);
});

test("matcher: reformatted and moved code still matches", () => {
  const content = "function f() {}\n\nconst total = items.reduce(\n  (a, b) => a + b,\n  0\n);\n";
  const m = matchFile(content, allLines(content), [traced([REDUCE])]);
  assert.deepEqual(highlighted(content, m.spans), ["3: const total = items.reduce(", "4: (a, b) => a + b,", "5: 0", "6: );"]);
});

test("matcher: only added lines are highlighted, but the whole file decides uniqueness", () => {
  const content = `${REDUCE}\nconst other = 1;\n`;
  // The recorded code is on line 1, which the diff did not add (it existed before).
  const m = matchFile(content, new Set([2]), [traced([REDUCE])]);
  assert.deepEqual([m.spans, m.aiTokens, m.addedTokens], [[], 0, 5]);
});

test("matcher: code that appears twice in the file is not marked (cannot tell which copy)", () => {
  const content = `${REDUCE}\n${REDUCE}\n`;
  const m = matchFile(content, allLines(content), [traced([REDUCE])]);
  assert.deepEqual(m.spans, []);
  assert.deepEqual(m.missing.length, 1);
});

test("matcher: short segments count only when they appear exactly once", () => {
  const content = "let x = 2;\nlet y = 2;\nreturn y;\n";
  const unique = matchFile(content, allLines(content), [traced(["let x = 2"])]);
  assert.deepEqual(highlighted(content, unique.spans), ["1: let x = 2"]);
  const twice = matchFile(content, allLines(content), [traced(["= 2;"])]);
  assert.deepEqual(twice.spans, []);
});

test("matcher: changes not found anymore are reported; a later change of the same code wins", () => {
  const content = `${REDUCE}\n`;
  const early = traced([REDUCE], "2026-10-21T09:00:00.000Z", "early");
  const late = traced([REDUCE], "2026-10-21T10:00:00.000Z", "late");
  const gone = traced(["this code was removed again by a human later on"]);
  const m = matchFile(content, allLines(content), [late, gone, early]);
  assert.deepEqual(
    m.spans.map((s) => s.change.model),
    ["late"]
  );
  assert.deepEqual(m.missing, [gone]);
});

// HTML

const reportFile = (over: Partial<ReportFile> = {}): ReportFile => ({
  path: "src/a.ts",
  status: "modified",
  hunks: [{ oldStart: 1, newStart: 1, lines: [{ type: "add", text: 'if (a < b) x = "<script>";', newLine: 1 }] }],
  spans: [],
  addedTokens: 0,
  aiTokens: 0,
  missing: 0,
  ...over,
});
const reportData = (files: ReportFile[]) => ({
  subject: "feature <x> → main",
  generatedAt: new Date("2026-10-21T11:40:00Z"),
  files,
  sessions: 1,
  missing: 0,
  warnings: [],
});

test("html: code, paths and labels are escaped", () => {
  const html = renderReport(reportData([reportFile({ path: "src/<b>.ts" })]));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("if (a &lt; b) x = &quot;&lt;script&gt;&quot;;"));
  assert.ok(html.includes("src/&lt;b&gt;.ts"));
  assert.ok(html.includes("feature &lt;x&gt; → main"));
  // Self-contained: nothing is loaded from elsewhere.
  assert.ok(!/(src|href)="(https?:)?\/\//.test(html));
});

test("html: AI spans are marked at their columns, with model and time", () => {
  const change = traced(["x"], "2026-10-21T11:14:24Z", "claude-opus-5-5");
  const html = renderReport(
    reportData([reportFile({ spans: [{ line: 1, start: 11, end: 26, change }], addedTokens: 10, aiTokens: 5 })])
  );
  assert.ok(
    html.includes(
      'if (a &lt; b) <mark title="claude-opus-5-5 · Edit · 21 Oct 2026, 11:14 UTC">x = &quot;&lt;script&gt;&quot;;</mark>'
    )
  );
  assert.match(html, /50% of the new code/);
});

test("html: a report without AI changes still renders", () => {
  const html = renderReport(reportData([]));
  assert.match(html, /0% of the new code/);
  assert.match(html, /0 of 0 changed files/);
});

// The whole report

test("report: from a branch with traces to index.html, locally against the default branch", async () => {
  const dir = makeRepo();
  const out = join(dir, "out");
  const { file, data } = await runReport({ cwd: dir, out, env: {} });
  assert.equal(file, join(out, "index.html"));
  assert.equal(data.subject, "HEAD → main");
  assert.equal(data.sessions, 2);
  // b.ts ("new file") was recorded; a.ts was changed without an agent.
  assert.deepEqual(
    data.files.map((f) => [f.path, f.aiTokens, f.addedTokens]),
    [
      ["a.ts", 0, 2],
      ["b.ts", 2, 2],
    ]
  );
  assert.equal(data.missing, 0);
  assert.match(readFileSync(file, "utf8"), /<mark title="m1 · Edit · [^"]+">new file<\/mark>/);
});

test("report: the CLI prints a summary and writes the report", () => {
  const dir = makeRepo();
  const r = spawnSync(
    process.execPath,
    // The loader by its full path: Node would look for "tsx" in the temporary repository (the cwd).
    [
      "--import",
      pathToFileURL(require.resolve("tsx")).href,
      join(__dirname, "..", "src", "main.ts"),
      "report",
      "--base",
      "main",
      "--out",
      "r",
    ],
    {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GITHUB_ACTIONS: "", GITLAB_CI: "" },
    }
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /AI share:\s+50% \(2 of 4 new tokens\)/);
  assert.match(r.stdout, /Files with AI:\s+1 of 2/);
  assert.ok(existsSync(join(dir, "r", "index.html")));
});

// GitHub output

const span = (line: number, change: TracedChange): AiSpan => ({ line, start: 0, end: 1, change });

test("github: one annotation per file with AI code, on its first AI line, with its line ranges", () => {
  const c = traced(["x"], "2026-10-21T11:14:24Z", "claude-opus-5-5");
  const annotations = fileAnnotations(
    [
      reportFile({ path: "a.ts", spans: [span(12, c), span(13, c), span(14, c), span(20, c)], addedTokens: 10, aiTokens: 4 }),
      reportFile({ path: "human.ts" }),
    ],
    "https://github.com/o/r/actions/runs/1"
  );
  assert.deepEqual(annotations, [
    {
      path: "a.ts",
      start_line: 12,
      end_line: 12,
      annotation_level: "notice",
      title: "AI-written code: 40% of this file's changes",
      message: "Lines 12–14, 20 · claude-opus-5-5\nDetails: https://github.com/o/r/actions/runs/1",
    },
  ]);
  assert.equal(lineRanges([1, 2, 3, 7, 9, 10]), "1–3, 7, 9–10");
});

/** Runs `fn` with fetch replaced by a fake that records the requests and answers with `status`. */
async function withFakeFetch(status: number, fn: () => Promise<void>) {
  const requests: Array<{ method: string; url: string; body: any }> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    requests.push({ method: String(init.method), url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ id: 7 }), { status });
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = real;
  }
  return requests;
}

const GITHUB_ENV = {
  GITHUB_ACTIONS: "true",
  GITHUB_API_URL: "https://api.github.test",
  GITHUB_REPOSITORY: "o/r",
  GITHUB_SERVER_URL: "https://github.test",
  GITHUB_RUN_ID: "99",
  GITHUB_TOKEN: "t0ken",
};

test("github: the check goes to GitHub's API only, with more than 50 annotations in several requests", async () => {
  const annotations = Array.from({ length: 120 }, (_, i) => ({
    path: `f${i}.ts`,
    start_line: 1,
    end_line: 1,
    annotation_level: "notice" as const,
    title: "t",
    message: "m",
  }));
  let result = "";
  const requests = await withFakeFetch(201, async () => {
    result = await createCheck({ headSha: "abc", title: "57% AI", summary: "s", annotations }, GITHUB_ENV);
  });
  assert.equal(result, "created");
  assert.deepEqual(
    requests.map((r) => [r.method, r.url, r.body.output.annotations.length]),
    [
      ["POST", "https://api.github.test/repos/o/r/check-runs", 50],
      ["PATCH", "https://api.github.test/repos/o/r/check-runs/7", 50],
      ["PATCH", "https://api.github.test/repos/o/r/check-runs/7", 20],
    ]
  );
  assert.deepEqual(
    [requests[0].body.name, requests[0].body.head_sha, requests[0].body.conclusion],
    ["goAirside", "abc", "neutral"]
  );
});

test("github: without token or permission the check is skipped, without failing", async () => {
  const check = { headSha: "abc", title: "t", summary: "s", annotations: [] };
  const { GITHUB_TOKEN: _, ...noToken } = GITHUB_ENV;
  const none = await withFakeFetch(201, async () => {
    assert.match(await createCheck(check, noToken), /no GITHUB_TOKEN/);
  });
  assert.equal(none.length, 0);
  await withFakeFetch(403, async () => {
    assert.match(await createCheck(check, GITHUB_ENV), /checks: write/);
  });
});

test("github: the step summary is written, and the check created, only in GitHub Actions", async () => {
  const c = traced(["x"]);
  const data = { ...reportData([reportFile({ spans: [span(1, c)], addedTokens: 4, aiTokens: 3 })]), subject: "f → main · #1" };
  const summary = join(mkdtempSync(join(root, "summary-")), "summary.md");
  const local = await withFakeFetch(201, () => writeGitHubOutput(data, "abc", {}));
  assert.equal(local.length, 0);

  const requests = await withFakeFetch(201, () =>
    writeGitHubOutput(data, "abc", { ...GITHUB_ENV, GITHUB_STEP_SUMMARY: summary })
  );
  const md = readFileSync(summary, "utf8");
  assert.match(md, /\*\*75%\*\* of the new code was written by AI · f → main · #1/);
  assert.match(md, /\| `src\/a.ts` \| 75% \|/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.output.title, "75% of the new code is AI-written");
  assert.equal(requests[0].body.details_url, "https://github.test/o/r/actions/runs/99");
  assert.equal(requests[0].body.output.annotations[0].path, "src/a.ts");
});

test("github: a small but present AI share shows as <1%, not 0%", () => {
  const c = traced(["x"]);
  const tiny = reportData([reportFile({ spans: [span(1, c)], addedTokens: 1000, aiTokens: 3 })]);
  assert.match(stepSummary(tiny), /\| `src\/a.ts` \| <1% \|/);
  assert.match(stepSummary(tiny), /\*\*<1%\*\* of the new code/);
});

// GitLab output

test("gitlab: one info finding per block of AI lines, on its first line", () => {
  const opus = traced(["x"], "2026-10-21T11:14:24Z", "claude-opus-5-5");
  const sonnet = traced(["y"], "2026-10-21T11:14:24Z", "claude-sonnet-5-5");
  const findings = codeQualityFindings([
    reportFile({ path: "a.ts", spans: [span(12, opus), span(13, opus), span(14, opus), span(20, sonnet)] }),
    reportFile({ path: "human.ts" }),
  ]);
  assert.deepEqual(
    findings.map((f) => [f.location.path, f.location.lines.begin, f.severity, f.description]),
    [
      ["a.ts", 12, "info", "AI-generated code: lines 12–14 · claude-opus-5-5"],
      ["a.ts", 20, "info", "AI-generated code: line 20 · claude-sonnet-5-5"],
    ]
  );
  assert.notEqual(findings[0].fingerprint, findings[1].fingerprint);
  assert.equal(codeQualityFindings([reportFile({ path: "a.ts", spans: [span(12, opus)] })])[0].fingerprint.length, 64);
});

test("gitlab: the Code Quality report is written only in GitLab CI", () => {
  const files = [reportFile({ spans: [span(1, traced(["x"]))] })];
  const out = mkdtempSync(join(root, "gitlab-"));
  writeGitLabOutput(files, out, {});
  assert.equal(existsSync(join(out, CODE_QUALITY_FILE)), false);
  writeGitLabOutput(files, out, { GITLAB_CI: "true" });
  assert.equal(JSON.parse(readFileSync(join(out, CODE_QUALITY_FILE), "utf8")).length, 1);
});

test("the report's only network code is the GitHub check", () => {
  const dir = join(__dirname, "..", "src", "services", "report");
  const files = (readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith(".ts"));
  const network = files.filter((f) =>
    /\bfetch\(|from "node:(https?|net|tls|dgram)"|XMLHttpRequest|WebSocket/.test(readFileSync(join(dir, f), "utf8"))
  );
  assert.deepEqual(
    network.map((f) => f.split("\\").join("/")),
    ["github/checks.ts"]
  );
});
