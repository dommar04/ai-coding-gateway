// Agent-neutral description of a tool call. Entry points (e.g. the Claude Code hooks) translate
// their own payloads into these types; the services only ever see these.

export interface ToolCall {
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  /** Working directory of the session (the project). */
  cwd: string;
  sessionId: string;
  /** The user prompt this call belongs to, when the agent reports it. */
  promptId?: string;
  /** Set when a sub-agent made the call. */
  agentId?: string;
  /** Where the agent keeps its session transcript, when it has one. */
  transcriptPath?: string;
}

export interface ToolResult {
  /** The tool's result, in the tool's own shape. */
  response: unknown;
  durationMs?: number | null;
}

/** What the gateway decided for a call: allowed, blocked, or would be blocked (monitor mode). */
export type CallDecision = "allowed" | "denied" | "would_deny";
