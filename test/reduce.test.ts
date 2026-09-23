import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OUTPUT_STRATEGIES, PAGING, type OutputContext, type StrategyState } from "../src/services/reduction/strategies";
import { reduceResult, type ReadCache } from "../src/services/reduction/pipeline";
import { adapterFor } from "../src/services/reduction/adapters";
import { rewriteInput, READ_LIMIT } from "../src/services/reduction/input-strategies";
import { readTranscript, cleanPromptText } from "../src/integrations/claude/transcript";

const spillDir = mkdtempSync(join(tmpdir(), "apichap-spill-"));
const strategy = (id: string) => OUTPUT_STRATEGIES.find((s) => s.id === id)!;
const ctx = (over: Partial<OutputContext> = {}): OutputContext => ({
  toolName: "Bash",
  toolInput: {},
  field: "stdout",
  toolUseId: "toolu_test",
  dryRun: false,
  spillDir,
  ...over,
});
const run = (id: string, text: string, over?: Partial<OutputContext>) => strategy(id).apply(text, ctx(over));
const allOn = () => new Map<string, StrategyState>(OUTPUT_STRATEGIES.map((s) => [s.id, "on"]));

test("ansi, progress and blank lines are cleaned losslessly", () => {
  assert.equal(run("ansi", "\x1b[32m✓ ok\x1b[0m \x1b[1mbold\x1b[22m"), "✓ ok bold");
  assert.equal(run("progress", "Downloading 10%\rDownloading 55%\rDownloaded\nnext"), "Downloaded\nnext");
  assert.equal(run("progress", "[#####.....]  50%\ndone"), "done");
  assert.equal(run("blank-lines", "a   \n\n\n\n\nb\t\n"), "a\n\nb\n");
});

test("repeated lines collapse with a count", () => {
  assert.equal(run("repeated-lines", "x\nwarn\nwarn\nwarn\nwarn\ny"), "x\nwarn\n⋯ (same line repeated 3 more times)\ny");
  assert.equal(run("repeated-lines", "a\na\nb"), "a\na\nb");
});

test("pretty JSON is compacted, other text untouched", () => {
  const pretty = JSON.stringify({ items: Array.from({ length: 10 }, (_, i) => ({ id: i, name: `item ${i}` })) }, null, 2);
  assert.equal(run("json-compact", pretty), JSON.stringify(JSON.parse(pretty)));
  assert.equal(run("json-compact", "not json\n  at all"), "not json\n  at all");
  assert.ok(!strategy("json-compact").applies("Bash", "stderr"));
});

test("test runs keep failures and drop passing tests (node:test TAP)", () => {
  const out = [
    ...Array.from({ length: 6 }, (_, i) => [
      `# Subtest: case ${i}`,
      `ok ${i + 1} - case ${i}`,
      "  ---",
      "  duration_ms: 1.2",
      "  ...",
    ]).flat(),
    "not ok 7 - broken case",
    "  error: expected 1 to equal 2",
    "# pass 6",
    "# fail 1",
  ].join("\n");
  const r = run("test-output", out);
  assert.match(r, /12 passing-test lines omitted/);
  assert.match(r, /not ok 7 - broken case/);
  assert.match(r, /expected 1 to equal 2/);
  assert.match(r, /# fail 1/);
  assert.doesNotMatch(r, /duration_ms/);
});

test("test-output leaves short or non-test output alone", () => {
  assert.equal(run("test-output", "✓ one\n✓ two\nall good"), "✓ one\n✓ two\nall good");
});

test("install logs drop chatter and count repeated warnings", () => {
  const log = [
    ...Array.from({ length: 6 }, (_, i) => `Collecting package${i}`),
    "npm WARN deprecated foo@1.0.0",
    "npm WARN deprecated foo@1.0.0",
    "ERROR: could not build wheels",
  ].join("\n");
  const r = run("install-logs", log);
  assert.match(r, /7 install\/build log lines omitted/);
  assert.match(r, /npm WARN deprecated foo@1\.0\.0 {2}\(×2\)/);
  assert.match(r, /ERROR: could not build wheels/);
});

test("framework stack frames fold, own frames stay", () => {
  const trace = [
    "Error: boom",
    "    at myFunction (C:/app/src/index.ts:10:5)",
    "    at Module._compile (node:internal/modules/cjs/loader:1554:14)",
    "    at Object.load (node:internal/modules/cjs/loader:1289:32)",
    "    at run (C:/app/node_modules/tsx/dist/cli.mjs:1:200)",
  ].join("\n");
  assert.equal(run("stack-traces", trace), "Error: boom\n    at myFunction (C:/app/src/index.ts:10:5)\n    ⋯ 3 framework frames");
});

test("lockfile diffs are summarized, source diffs kept", () => {
  const lock = Array.from({ length: 30 }, (_, i) => `+  "dep${i}": "1.0.${i}",`).join("\n");
  const diff = `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n+const x = 1;\ndiff --git a/package-lock.json b/package-lock.json\n--- a/package-lock.json\n+++ b/package-lock.json\n${lock}\n`;
  const r = run("generated-diffs", diff);
  assert.match(r, /\+const x = 1;/);
  assert.match(r, /generated file: \+30 −0 lines omitted/);
  assert.doesNotMatch(r, /dep17/);
});

test("very long lines are shortened", () => {
  const r = run("long-lines", `short\n${"x".repeat(5000)}`);
  assert.match(r, /^short\nx{300} ⋯ \[apichap gateway\] line shortened, 5,000 chars$/);
});

test("paging keeps head and tail and spills the full output", () => {
  const text = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n");
  const r = run("paging", text, { toolUseId: "toolu_page1" });
  assert.match(r, /^line 0\n/);
  assert.match(r, /line 999$/);
  assert.doesNotMatch(r, /line 500\n/);
  const file = join(spillDir, "toolu_page1-stdout.txt");
  assert.ok(r.includes(file));
  assert.equal(readFileSync(file, "utf8"), text);

  // Measure mode (dry run) computes the same text but writes nothing.
  const dry = run("paging", text, { toolUseId: "toolu_page2", dryRun: true });
  assert.ok(dry.length < text.length);
  assert.ok(!existsSync(join(spillDir, "toolu_page2-stdout.txt")));
  assert.equal(run("paging", "small output"), "small output");
});

test("pipeline: only 'on' changes the result, 'measure' reports potential savings", () => {
  const stdout = "\x1b[31m" + Array.from({ length: PAGING.maxLines + 100 }, (_, i) => `row ${i}`).join("\n");
  const states = allOn();
  states.set("paging", "measure");
  const r = reduceResult({
    toolName: "Bash",
    toolInput: { command: "x" },
    toolResponse: { stdout, stderr: "", interrupted: false },
    toolUseId: "toolu_p",
    states,
    spillDir,
  });
  const response = r.response as { stdout: string; interrupted: boolean };
  assert.equal(response.interrupted, false); // shape preserved
  assert.ok(!response.stdout.includes("\x1b"));
  assert.ok(response.stdout.includes("row 450")); // paging only measured
  assert.ok(r.savedPotential > 0);
  assert.deepEqual(r.breakdown.map((b) => [b.id, b.state]).sort(), [
    ["ansi", "on"],
    ["paging", "measure"],
  ]);
  assert.ok(r.resultTokensAfter < r.resultTokens);
});

test("pipeline: nothing changes when everything is off", () => {
  const states = new Map<string, StrategyState>(OUTPUT_STRATEGIES.map((s) => [s.id, "off"]));
  const r = reduceResult({
    toolName: "Bash",
    toolInput: {},
    toolResponse: { stdout: "\x1b[1mhi\x1b[0m", stderr: "" },
    toolUseId: "t",
    states,
    spillDir,
  });
  assert.equal(r.response, undefined);
  assert.equal(r.resultTokens, r.resultTokensAfter);
});

test("Read content is never rewritten except for unchanged re-reads", () => {
  const content = "\x1b[1mline\x1b[0m\n\n\n\n" + "x".repeat(3000);
  const resp = { type: "text", file: { filePath: "C:/a.ts", content, numLines: 5 } };
  const seen = new Map<string, { hash: string; at: string; toolUseId: string | null }>();
  const cache: ReadCache = {
    lastRead: (k) => seen.get(k) ?? null,
    rememberRead: (k, hash) => seen.set(k, { hash, at: "2026-09-16T10:00:00.000Z", toolUseId: "toolu_first" }),
    callIdFor: () => 812,
  };
  const first = reduceResult({
    toolName: "Read",
    toolInput: { file_path: "C:/a.ts" },
    toolResponse: resp,
    toolUseId: "toolu_first",
    states: allOn(),
    spillDir,
    readCache: cache,
  });
  assert.equal(first.response, undefined);

  const again = reduceResult({
    toolName: "Read",
    toolInput: { file_path: "C:/a.ts" },
    toolResponse: resp,
    toolUseId: "toolu_second",
    states: allOn(),
    spillDir,
    readCache: cache,
  });
  const file = (again.response as { file: { content: string; filePath: string } }).file;
  assert.equal(file.filePath, "C:/a.ts");
  assert.match(file.content, /Unchanged since you read it at .* \(call #812\)/);

  // A different range, or changed content, is a fresh read.
  const other = reduceResult({
    toolName: "Read",
    toolInput: { file_path: "C:/a.ts", offset: 1 },
    toolResponse: resp,
    toolUseId: "toolu_third",
    states: allOn(),
    spillDir,
    readCache: cache,
  });
  assert.equal(other.response, undefined);
});

test("MCP text blocks are reduced, image blocks kept", () => {
  const pretty = JSON.stringify({ rows: Array.from({ length: 20 }, (_, i) => ({ i })) }, null, 2);
  const resp = [
    { type: "text", text: pretty },
    { type: "image", data: "AAAA", mimeType: "image/png" },
  ];
  const r = reduceResult({
    toolName: "mcp__db__query",
    toolInput: {},
    toolResponse: resp,
    toolUseId: "t",
    states: allOn(),
    spillDir,
  });
  const out = r.response as Array<{ type: string; text?: string; data?: string }>;
  assert.equal(out[0].text, JSON.stringify(JSON.parse(pretty)));
  assert.deepEqual(out[1], resp[1]);
});

test("visible tokens reflect what Claude sees", () => {
  assert.equal(adapterFor("Write").visibleTokens({ filePath: "C:/a.ts", content: "x".repeat(100_000) }) < 50, true);
  assert.equal(adapterFor("Bash").visibleTokens({ stdout: "x".repeat(400), stderr: "" }), 100);
});

test("input rewrites: grep head_limit, git log -n, npm quiet, read limit", () => {
  const on = () => true;
  assert.deepEqual(rewriteInput("Grep", { pattern: "x", output_mode: "content" }, ".", on)?.input, {
    pattern: "x",
    output_mode: "content",
    head_limit: 250,
  });
  assert.equal(rewriteInput("Grep", { pattern: "x" }, ".", on), null);
  assert.equal(rewriteInput("Bash", { command: "git log --oneline" }, ".", on)?.input.command, "git log -n 50 --oneline");
  assert.equal(rewriteInput("Bash", { command: "git log -n 5" }, ".", on), null);
  assert.equal(rewriteInput("Bash", { command: "git log main..feature" }, ".", on), null);
  assert.equal(rewriteInput("Bash", { command: "npm ci" }, ".", on)?.input.command, "npm ci --no-audit --no-fund --no-progress");
  assert.equal(rewriteInput("Bash", { command: "npm ci && npm test" }, ".", on), null);
  assert.equal(
    rewriteInput("Bash", { command: "git log" }, ".", () => false),
    null
  );

  const dir = mkdtempSync(join(tmpdir(), "apichap-read-"));
  const big = join(dir, "big.txt");
  writeFileSync(big, Array.from({ length: 5000 }, (_, i) => `line ${i} ${"pad".repeat(5)}`).join("\n"));
  const r = rewriteInput("Read", { file_path: big }, dir, on);
  assert.equal(r?.input.limit, READ_LIMIT);
  assert.match(r!.notes[0], /lines 1–1000 of 5,000/);
  assert.equal(rewriteInput("Read", { file_path: big, offset: 10 }, dir, on), null);
});

test("transcript: prompt text and deduplicated API usage per prompt", () => {
  const dir = mkdtempSync(join(tmpdir(), "apichap-transcript-"));
  const path = join(dir, "session.jsonl");
  const usage = { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50, output_tokens: 20 };
  const lines = [
    {
      type: "user",
      promptId: "p1",
      timestamp: "2026-09-16T10:00:00Z",
      message: { role: "user", content: "fix the bug <system-reminder>noise</system-reminder>" },
    },
    { type: "assistant", message: { id: "m1", usage, content: [{ type: "text", text: "a" }] } },
    { type: "assistant", message: { id: "m1", usage, content: [{ type: "tool_use" }] } }, // same response, second block
    { type: "user", promptId: "p1", message: { role: "user", content: [{ type: "tool_result", content: "ok" }] } },
    { type: "assistant", message: { id: "m2", usage, content: [] } },
    {
      type: "user",
      promptId: "p2",
      timestamp: "2026-09-16T10:05:00Z",
      message: { role: "user", content: [{ type: "text", text: "next task" }] },
    },
  ];
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const prompts = readTranscript(path);
  const p1 = prompts.get("p1")!;
  assert.equal(p1.text, "fix the bug");
  assert.deepEqual(p1.usage, { inputTokens: 20, cacheReadTokens: 2000, cacheWriteTokens: 100, outputTokens: 40, requests: 2 });
  assert.equal(prompts.get("p2")!.text, "next task");

  // Incremental: appended lines are picked up on the next read.
  writeFileSync(
    path,
    readFileSync(path, "utf8") + JSON.stringify({ type: "assistant", message: { id: "m3", usage, content: [] } }) + "\n"
  );
  assert.equal(readTranscript(path).get("p2")!.usage.requests, 1);
  assert.equal(cleanPromptText("<task-notification>x</task-notification>"), "⚙ Background task finished (automatic message)");
});
