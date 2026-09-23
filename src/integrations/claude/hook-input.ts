import type { ToolCall } from "../../entities/tool-call";

// Claude Code hook payloads (JSON on stdin) and their translation into the gateway's ToolCall.

export interface ClaudeToolHookInput {
  session_id: string;
  prompt_id?: string;
  transcript_path?: string;
  cwd: string;
  hook_event_name: "PreToolUse" | "PostToolUse";
  tool_name: string;
  tool_input: unknown;
  tool_use_id: string;
  /** Present when a sub-agent made the call. */
  agent_id?: string;
  /** PostToolUse: how long the tool ran. */
  duration_ms?: number;
  /** PostToolUse: the tool's result, in the tool's own shape. */
  tool_response?: unknown;
}

export interface ClaudeSessionHookInput {
  session_id?: string;
  hook_event_name?: "PreCompact" | "SessionStart" | string;
  /** SessionStart: startup, resume, clear or compact. */
  source?: string;
}

export function toToolCall(input: ClaudeToolHookInput): ToolCall {
  return {
    toolUseId: input.tool_use_id,
    toolName: input.tool_name,
    toolInput: input.tool_input,
    cwd: input.cwd,
    sessionId: input.session_id,
    promptId: input.prompt_id,
    agentId: input.agent_id,
    transcriptPath: input.transcript_path,
  };
}
