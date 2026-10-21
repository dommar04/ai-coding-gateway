import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TraceFile } from "../src/services/trace/helper/trace-file";
import { encodeSegment, hashToken, tokenize } from "../src/services/trace/helper/hasher";
import { addedSeg } from "../src/services/trace/helper/diff";
import { shellWrites } from "../src/services/trace/helper/shell-writes";
import { textEdits, traceToolCall } from "../src/services/trace/handler";
import type { ToolCall } from "../src/entities/tool-call";
import { latestModel } from "../src/integrations/claude/transcript";
import { toToolCall as claudeToolCall } from "../src/integrations/claude/hook-input";
import { toToolCall as codexToolCall } from "../src/integrations/codex/hook-input";

const root = mkdtempSync(join(tmpdir(), "apichap-trace-"));
after(() => rmSync(root, { recursive: true, force: true }));

const SESSION = { id: "a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d", agent: "claude", agentVersion: "2.1.0" };
const lines = (file: string) =>
  readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

test("the first change creates the session file with its session line", () => {
  const project = mkdtempSync(join(root, "p-"));
  const trace = new TraceFile(project, SESSION);
  assert.equal(trace.existingFile(), null);

  const at = new Date("2026-10-21T09:15:03.412Z");
  assert.ok(
    trace.addChange({ tool: "Write", path: join(project, "src", "app.ts"), seg: ["AAE="], model: "claude-opus-5-5", at })
  );

  assert.deepEqual(readdirSync(trace.dir), ["2026-10-21T09-15-03Z_a1b2c3d4.jsonl"]);
  const [session, change] = lines(trace.existingFile()!);
  assert.deepEqual(
    { ...session, gateway: undefined },
    {
      kind: "session",
      format: "goairside-trace",
      v: 1,
      tokenizer: 1,
      session: SESSION.id,
      agent: "claude",
      agentVersion: "2.1.0",
      gateway: undefined,
      started: "2026-10-21T09:15:03.412Z",
    }
  );
  assert.equal(typeof session.gateway, "string");
  assert.deepEqual(change, {
    kind: "change",
    t: "2026-10-21T09:15:03.412Z",
    model: "claude-opus-5-5",
    tool: "Write",
    path: "src/app.ts",
    seg: ["AAE="],
  });
});

test("later changes, also from a new instance (a new hook process), append to the same file", () => {
  const project = mkdtempSync(join(root, "p-"));
  new TraceFile(project, SESSION).addChange({ tool: "Write", path: "a.ts", seg: ["AAE="] });
  new TraceFile(project, SESSION).addChange({ tool: "Edit", path: "a.ts", seg: ["AAI=", "AAM="] });

  const trace = new TraceFile(project, SESSION);
  assert.equal(readdirSync(trace.dir).length, 1);
  const all = lines(trace.existingFile()!);
  assert.deepEqual(
    all.map((l) => l.kind),
    ["session", "change", "change"]
  );
  assert.equal(all[2].model, undefined);
});

test("each session gets its own file", () => {
  const project = mkdtempSync(join(root, "p-"));
  new TraceFile(project, SESSION).addChange({ tool: "Write", path: "a.ts", seg: ["AAE="] });
  new TraceFile(project, { id: "9f8e7d6c-0000-0000-0000-000000000000", agent: "codex" }).addChange({
    tool: "MultiEdit",
    path: "a.ts",
    seg: ["AAE="],
  });
  assert.equal(readdirSync(join(project, ".goairside", "traces")).length, 2);
});

test("nothing is written for files outside the project or changes without segments", () => {
  const project = mkdtempSync(join(root, "p-"));
  const trace = new TraceFile(project, SESSION);
  assert.equal(trace.addChange({ tool: "Write", path: join(root, "other.ts"), seg: ["AAE="] }), false);
  assert.equal(trace.addChange({ tool: "Write", path: "../other.ts", seg: ["AAE="] }), false);
  assert.equal(trace.addChange({ tool: "Edit", path: "a.ts", seg: [] }), false);
  assert.equal(trace.existingFile(), null);
});

test("paths are relative to the project with / separators", () => {
  const trace = new TraceFile(join(root, "proj"), SESSION);
  assert.equal(trace.relativePath(join(root, "proj", "src", "lib", "a.ts")), "src/lib/a.ts");
  assert.equal(trace.relativePath("src/a.ts"), "src/a.ts");
  assert.equal(trace.relativePath(join(root, "proj")), null);
  assert.equal(trace.relativePath(join(root, "proj-other", "a.ts")), null);
});

// Hasher

test("tokens are words and single symbols; whitespace and quotes are dropped", () => {
  assert.deepEqual(tokenize("const total = items.reduce((a, b) => a + b, 0);"), [
    ..."const total = items . reduce ( ( a , b ) = > a + b , 0 ) ;".split(" "),
  ]);
  assert.deepEqual(tokenize(`x = 'hi'`), tokenize(`x  =\n  "hi"`));
  assert.deepEqual(tokenize("größe_1 $el"), ["größe_1", "$el"]);
});

test("tokens are hashed with FNV-1a, lower 16 bits, and packed as Base64", () => {
  assert.equal(hashToken("a"), 0x292c); // FNV-1a 32 of "a" is 0xe40c292c
  const seg = encodeSegment(tokenize("const total = 0;"));
  assert.equal(seg.length, 16);
  assert.equal(Buffer.from(seg, "base64").readUInt16BE(0), hashToken("const"));
});

// Added segments

const added = (before: string, after: string) => addedSeg(tokenize(before), tokenize(after)).map((s) => s.join(" "));

test("only the added tokens become segments", () => {
  assert.deepEqual(added("a + b", "a + c + b"), ["c +"]);
  assert.deepEqual(added("let x = 1;", "let x = 2;"), ["2"]);
  assert.deepEqual(added("f(a); g(b);", "f(a, z); g(b, y);"), [", z", ", y"]);
  assert.deepEqual(added("", "new code"), ["new code"]);
});

test("deleting or reformatting adds nothing", () => {
  assert.deepEqual(added("a; b; c;", "a; c;"), []);
  assert.deepEqual(added("if (x) { y(); }", "if (x) {\n  y();\n}"), []);
});

// Handler

const call = (toolName: string, toolInput: unknown, extra: Partial<ToolCall> = {}): ToolCall => ({
  toolUseId: "t1",
  toolName,
  toolInput,
  cwd: "/p",
  sessionId: SESSION.id,
  ...extra,
});

test("Claude Write, Edit and MultiEdit become text edits", () => {
  assert.deepEqual(textEdits(call("Write", { file_path: "/p/a.ts", content: "x" })), [
    { path: "/p/a.ts", before: "", after: "x" },
  ]);
  assert.deepEqual(textEdits(call("Edit", { file_path: "/p/a.ts", old_string: "x", new_string: "y" })), [
    { path: "/p/a.ts", before: "x", after: "y" },
  ]);
  assert.deepEqual(
    textEdits(
      call("MultiEdit", {
        file_path: "/p/a.ts",
        edits: [
          { old_string: "a", new_string: "b" },
          { old_string: "c", new_string: "d" },
        ],
      })
    ),
    [
      { path: "/p/a.ts", before: "a", after: "b" },
      { path: "/p/a.ts", before: "c", after: "d" },
    ]
  );
  assert.deepEqual(textEdits(call("Bash", { command: "cat > a.ts <<'EOF'\nx\nEOF" })), [
    { path: "a.ts", before: "", after: "x\n" },
  ]);
  assert.deepEqual(textEdits(call("Bash", { command: "npm run format" })), []);
  assert.deepEqual(textEdits(call("Read", { file_path: "/p/a.ts" })), []);
});

test("a Codex patch becomes one text edit per added or updated file", () => {
  const command = [
    "*** Begin Patch",
    "*** Add File: src/new.ts",
    "+export const a = 1;",
    "*** Update File: src/old.ts",
    "*** Move to: src/moved.ts",
    "@@ function f() {",
    " keep();",
    "-drop();",
    "+add();",
    "*** Delete File: src/gone.ts",
    "*** End Patch",
  ].join("\n");
  assert.deepEqual(textEdits(call("MultiEdit", { command }, { integration: "codex" })), [
    { path: "src/new.ts", before: "", after: "export const a = 1;\n" },
    { path: "src/moved.ts", before: "keep();\ndrop();\n", after: "keep();\nadd();\n" },
  ]);
});

test("traceToolCall writes the added segments to the session's trace", () => {
  const project = mkdtempSync(join(root, "p-"));
  const edit = call(
    "Edit",
    { file_path: join(project, "a.ts"), old_string: "let x = 1;", new_string: "let x = 2;" },
    { cwd: project, model: "claude-opus-5-5" }
  );
  assert.equal(traceToolCall(edit), 1);

  const patch = "*** Begin Patch\n*** Add File: b.ts\n+b();\n*** End Patch";
  assert.equal(traceToolCall(call("MultiEdit", { command: patch }, { cwd: project, integration: "codex" })), 1);

  const [session, first, second] = lines(new TraceFile(project, SESSION).existingFile()!);
  assert.equal(session.agent, "claude");
  assert.deepEqual([first.tool, first.path, first.model, first.seg], ["Edit", "a.ts", "claude-opus-5-5", [encodeSegment(["2"])]]);
  assert.deepEqual(
    [second.tool, second.path, second.model, second.seg],
    ["apply_patch", "b.ts", undefined, [encodeSegment(tokenize("b();"))]]
  );
});

test("calls without added content leave no trace file", () => {
  const project = mkdtempSync(join(root, "p-"));
  const edit = call("Edit", { file_path: join(project, "a.ts"), old_string: "a; b;", new_string: "a;" }, { cwd: project });
  assert.equal(traceToolCall(edit), 0);
  assert.equal(new TraceFile(project, SESSION).existingFile(), null);
});

// Model

const assistant = (model: string) =>
  JSON.stringify({ type: "assistant", message: { id: model, model, content: [{ type: "text", text: "hi" }] } });

test("the model is the one of the latest assistant entry in the Claude transcript", () => {
  const transcript = join(mkdtempSync(join(root, "t-")), "session.jsonl");
  writeFileSync(
    transcript,
    [
      JSON.stringify({ type: "user", promptId: "p1", message: { content: "go" } }),
      assistant("claude-sonnet-5-5"),
      assistant("claude-opus-5-5"),
      assistant("<synthetic>"),
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_result" }] } }),
      '{"type":"assistant","message":{"model":"cut', // still being written
    ].join("\n")
  );
  assert.equal(latestModel(transcript), "claude-opus-5-5");
  assert.equal(latestModel(join(root, "missing.jsonl")), undefined);
  assert.equal(latestModel(undefined), undefined);
});

test("Claude reads the model only for finished calls; Codex sends it in the hook input", () => {
  const transcript = join(mkdtempSync(join(root, "t-")), "session.jsonl");
  writeFileSync(transcript, assistant("claude-opus-5-5") + "\n");
  const input = {
    session_id: "s",
    prompt_id: "p",
    transcript_path: transcript,
    cwd: "/p",
    tool_name: "Edit",
    tool_input: {},
    tool_use_id: "t",
  };
  assert.equal(claudeToolCall({ ...input, hook_event_name: "PostToolUse" }).model, "claude-opus-5-5");
  assert.equal(claudeToolCall({ ...input, hook_event_name: "PreToolUse" }).model, undefined);

  const codex = {
    session_id: "s",
    cwd: "/p",
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_use_id: "t",
    tool_input: {},
  };
  assert.equal(codexToolCall({ ...codex, model: "gpt-5.5-codex" }).model, "gpt-5.5-codex");
  assert.equal(codexToolCall(codex).model, undefined);
});

// Shell writes

const writes = (command: string, shell: "bash" | "powershell" = "bash") =>
  shellWrites(command, shell).map((e) => [e.path, e.after]);

test("bash heredocs written with cat and tee are traced", () => {
  assert.deepEqual(writes("cat > src/a.ts <<'EOF'\nexport const a = 1;\nEOF"), [["src/a.ts", "export const a = 1;\n"]]);
  assert.deepEqual(writes("cat >> notes.md <<EOF\nmore\nEOF"), [["notes.md", "more\n"]]);
  assert.deepEqual(writes("cat <<EOF >a.txt\nx\nEOF"), [["a.txt", "x\n"]]);
  assert.deepEqual(writes("tee -a log.txt b.txt > /dev/null <<'EOF'\nx\nEOF"), [
    ["log.txt", "x\n"],
    ["b.txt", "x\n"],
  ]);
  assert.deepEqual(writes('mkdir -p src && cat > "src/my file.ts" <<EOF && echo done\nx\nEOF'), [["src/my file.ts", "x\n"]]);
});

test("bash echo and printf with a redirect are traced", () => {
  assert.deepEqual(writes('echo "hello world" > a.txt'), [["a.txt", "hello world"]]);
  assert.deepEqual(writes("echo -n 'x = 1' >> a.txt 2>&1"), [["a.txt", "x = 1"]]);
  assert.deepEqual(writes("echo -e 'a\nb' > a.txt"), [["a.txt", "a\nb"]]);
  assert.deepEqual(writes("printf 'line\n' &> a.txt"), [["a.txt", "line\n"]]);
});

test("bash commands that don't write their own content are not traced", () => {
  assert.deepEqual(writes("cat a.txt > b.txt"), []);
  assert.deepEqual(writes("cat <<EOF\nshown, not written\nEOF"), []);
  assert.deepEqual(writes("echo hi"), []);
  assert.deepEqual(writes("echo hi > /dev/null"), []);
  assert.deepEqual(writes("npm test 2> errors.txt"), []);
  assert.deepEqual(writes("echo hi >&2"), []);
  assert.deepEqual(writes("sort < in.txt > out.txt"), []);
  assert.deepEqual(writes("git commit -m \"$(cat <<'EOF'\nmsg\nEOF\n)\""), []);
});

test("PowerShell Set-Content, Add-Content and Out-File are traced", () => {
  assert.deepEqual(writes("Set-Content -Path src\a.ts -Value 'export const a = 1;'", "powershell"), [
    ["src\a.ts", "export const a = 1;"],
  ]);
  assert.deepEqual(writes('Add-Content notes.md "more `n text" -Encoding utf8', "powershell"), [["notes.md", "more \n text"]]);
  assert.deepEqual(writes("@'\nline 1\nit''s line 2\n'@ | Set-Content -LiteralPath a.txt -NoNewline", "powershell"), [
    ["a.txt", "line 1\nit''s line 2"],
  ]);
  assert.deepEqual(writes("'x' | Out-File -FilePath out.txt; Get-ChildItem", "powershell"), [["out.txt", "x"]]);
  assert.deepEqual(writes('"text" > a.txt', "powershell"), [["a.txt", "text"]]);
});

test("PowerShell commands that don't write their own content are not traced", () => {
  assert.deepEqual(writes("Get-Content a.txt | Set-Content b.txt", "powershell"), []);
  assert.deepEqual(writes("npm test > out.txt", "powershell"), []);
  assert.deepEqual(writes("Set-Content -Path a.txt -Value $text", "powershell"), [["a.txt", "$text"]]);
  assert.deepEqual(writes("'x' | Out-File $null", "powershell"), []);
});
