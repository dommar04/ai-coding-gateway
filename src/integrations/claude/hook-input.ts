import type { ToolCall } from "../../entities/tool-call";
import { randomUUID } from "node:crypto";
import { latestPromptId, type PromptSubmission } from "../../storage/tables/prompts";

export function toPrompt(input: unknown): PromptSubmission {
  const p = input as { session_id?: string; prompt_id?: string; prompt?: string; cwd?: string; transcript_path?: string };
  if (typeof p?.session_id !== "string" || !p.session_id || typeof p.prompt !== "string")
    throw new Error("Incomplete Claude prompt payload");
  return {
    promptId: p.prompt_id || `claude:${p.session_id}:${randomUUID()}`,
    sessionId: p.session_id,
    integration: "claude",
    text: p.prompt,
    project: p.cwd,
    transcriptPath: p.transcript_path,
  };
}

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
    promptId: input.prompt_id ?? latestPromptId(input.session_id, "claude"),
    agentId: input.agent_id,
    transcriptPath: input.transcript_path,
  };
}
