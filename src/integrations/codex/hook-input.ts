import type { ToolCall } from "../../entities/tool-call";
import type { PromptSubmission } from "../../storage/tables/prompts";
export function codexPromptId(sessionId: string, turnId: string): string {
  return `codex:${sessionId}:${turnId}`;
}
export function toPrompt(input: unknown): PromptSubmission {
  const p = input as { session_id?: string; turn_id?: string; prompt?: string; cwd?: string };
  if (
    typeof p?.session_id !== "string" ||
    !p.session_id ||
    typeof p.turn_id !== "string" ||
    !p.turn_id ||
    typeof p.prompt !== "string"
  )
    throw new Error("Incomplete Codex prompt payload");
  return {
    promptId: codexPromptId(p.session_id, p.turn_id),
    sessionId: p.session_id,
    integration: "codex",
    text: p.prompt,
    project: p.cwd,
  };
}
export interface CodexHookInput {
  session_id: string;
  cwd: string;
  hook_event_name: string;
  turn_id?: string;
  transcript_path?: string | null;
  agent_id?: string;
  tool_name: string;
  tool_use_id: string;
  tool_input: unknown;
  tool_response?: unknown;
  source?: string;
}
export function toToolCall(input: CodexHookInput): ToolCall {
  if (!input.session_id || !input.tool_use_id || !input.tool_name || !input.cwd) throw new Error("Incomplete Codex hook payload");
  let toolName = input.tool_name;
  let toolInput = input.tool_input;
  if (toolName === "apply_patch") {
    const command = (toolInput as { command?: unknown })?.command;
    if (typeof command !== "string") throw new Error("Missing patch command");
    const lines = command.replace(/\r\n/g, "\n").trim().split("\n");
    if (lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch") throw new Error("Invalid patch envelope");
    const paths = lines.flatMap((line) => {
      const match = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/.exec(line);
      return match ? [match[1]] : [];
    });
    if (!paths.length) throw new Error("Patch contains no paths");
    toolName = "MultiEdit";
    const deletedPaths = lines.flatMap((line) => {
      const match = /^\*\*\* Delete File: (.+)$/.exec(line);
      return match ? [match[1]] : [];
    });
    toolInput = { command, file_paths: paths, deleted_paths: deletedPaths };
  }
  return {
    integration: "codex",
    toolUseId: `codex:${input.session_id}:${input.tool_use_id}`,
    toolName,
    toolInput,
    cwd: input.cwd,
    sessionId: input.session_id,
    promptId: input.turn_id ? codexPromptId(input.session_id, input.turn_id) : undefined,
    agentId: input.agent_id,
    // Codex's transcript format is not a stable hook interface. Do not parse it as Claude JSONL.
  };
}
