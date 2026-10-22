import type { ToolCall } from "../../entities/tool-call";
import { addedSeg } from "./helper/diff";
import { encodeSegment, tokenize } from "./helper/hasher";
import { shellWrites } from "./helper/shell-writes";
import { TraceFile } from "./helper/trace-file";

// Records what an agent wrote into the session's trace file. Called after a tool call succeeded.

/** One write into a file: the text it replaced and the text it wrote. */
export interface TextEdit {
  path: string;
  before: string;
  after: string;
}

/**
 * Writes the call's added content to the trace. Returns how many change lines were written.
 * `pipelines`: whether the project's first trace also adds the report to the repository's CI.
 */
export function traceToolCall(call: ToolCall, { pipelines = true } = {}): number {
  const edits = textEdits(call);
  if (!edits.length) return 0;
  const trace = new TraceFile(call.cwd, { id: call.sessionId, agent: call.integration ?? "claude" }, { pipelines });
  let written = 0;
  for (const edit of edits) {
    const seg = addedSeg(tokenize(edit.before), tokenize(edit.after)).map(encodeSegment);
    if (trace.addChange({ tool: toolLabel(call), path: edit.path, seg, model: call.model })) written++;
  }
  return written;
}

/** The writes of a tool call. */
export function textEdits(call: ToolCall): TextEdit[] {
  const input = (call.toolInput ?? {}) as Record<string, unknown>;
  const path = typeof input.file_path === "string" ? input.file_path : null;
  switch (call.toolName) {
    case "Write":
      return path && typeof input.content === "string" ? [{ path, before: "", after: input.content }] : [];
    case "Edit":
      return path && typeof input.old_string === "string" && typeof input.new_string === "string"
        ? [{ path, before: input.old_string, after: input.new_string }]
        : [];
    case "MultiEdit":
      // Codex's apply_patch arrives as MultiEdit with the raw patch in `command`
      // (integrations/codex/hook-input.ts); Claude's MultiEdit has an `edits` list.
      return typeof input.command === "string" ? codexPatchEdits(input.command) : claudeMultiEdits(path, input.edits);
    case "Bash":
    case "PowerShell":
      return typeof input.command === "string"
        ? shellWrites(input.command, call.toolName === "Bash" ? "bash" : "powershell")
        : [];
    default:
      return [];
  }
}

function claudeMultiEdits(path: string | null, edits: unknown): TextEdit[] {
  if (!path || !Array.isArray(edits)) return [];
  return (edits as Array<{ old_string?: unknown; new_string?: unknown }>).flatMap((e) =>
    typeof e.old_string === "string" && typeof e.new_string === "string"
      ? [{ path, before: e.old_string, after: e.new_string }]
      : []
  );
}

/** Per file: the replaced lines (context and "-") and the written lines (context and "+"). */
function codexPatchEdits(patch: string): TextEdit[] {
  const edits: TextEdit[] = [];
  let edit: TextEdit | null = null;
  for (const line of patch.replace(/\r\n/g, "\n").split("\n")) {
    const header = /^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$/.exec(line);
    if (header) {
      if (header[1] === "Move to") {
        if (edit) edit.path = header[2];
        continue;
      }
      edit = header[1] === "Delete File" ? null : { path: header[2], before: "", after: "" };
      if (edit) edits.push(edit);
    } else if (edit && line.startsWith("+")) {
      edit.after += line.slice(1) + "\n";
    } else if (edit && line.startsWith("-")) {
      edit.before += line.slice(1) + "\n";
    } else if (edit && line.startsWith(" ")) {
      edit.before += line.slice(1) + "\n";
      edit.after += line.slice(1) + "\n";
    }
  }
  return edits;
}

/** The trace names the tool the agent used, so a Codex patch is recorded as apply_patch. */
function toolLabel(call: ToolCall): string {
  return call.toolName === "MultiEdit" && typeof (call.toolInput as { command?: unknown })?.command === "string"
    ? "apply_patch"
    : call.toolName;
}
