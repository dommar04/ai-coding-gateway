import type { ToolCall, ToolResult } from "../entities/tool-call";
import { logError } from "../helpers/errors";
import { emitEvent } from "./activity/events";
import { completeCall, getInputRewrite, insertCall } from "../storage/tables/tool-calls";
import { forgetContext, reduceToolResult, rewriteToolInput, type ReduceResult } from "./reduction";
import { inputTokens } from "./reduction/adapters";
import { effectiveMode, getMode, modeOverride } from "./settings";
import { checkToolSecurity, type SecurityCheck } from "./tool-security";
import { gatewayErrorMessage } from "./tool-security/messages";

// The gateway workflow, independent of any agent:
//
//   before a tool call:  1. tool security (unless mode is "off")   → may block the call
//                        2. input reduction (strategies set to on)  → may shrink the call
//                        3. log the call
//   after a tool call:   1. result reduction                        → may shrink the result
//                        2. log result and token figures
//   context reset:       forget what the agent had already read
//
// Entry points (Claude Code hooks, ...) translate their payloads into a ToolCall and back.

export interface BeforeToolCall {
  /** Set when the call must not run: the message for the agent. */
  block?: string;
  /** Set when the call should run with a smaller input. */
  updatedInput?: Record<string, unknown>;
}

export interface AfterToolCall {
  /** Set when the agent should get a shortened result (same shape as the original). */
  updatedResponse?: unknown;
  /** Extra notes for the agent, e.g. "this Read was limited to 1,000 lines". */
  additionalContext?: string;
}

const ALLOWED: SecurityCheck = { decision: "allowed", ruleId: null, requestId: null, message: null };

export function beforeToolCall(call: ToolCall): BeforeToolCall {
  const mode = effectiveMode();

  // 1. Tool security
  const check = mode === "off" ? ALLOWED : checkToolSecurity(call, mode);
  if (check.decision === "denied") {
    record(call, check);
    return { block: check.message ?? gatewayErrorMessage() };
  }

  // 2. Input reduction
  const rewrite = rewriteToolInput(call);

  // 3. Log
  record(call, check, rewrite ? { applied: rewrite.applied, notes: rewrite.notes, original: call.toolInput } : undefined);
  // No "allow" is ever returned: the agent's own permission prompts still apply. The gateway only tightens.
  return rewrite ? { updatedInput: rewrite.input } : {};
}

/**
 * The gateway itself failed before a call. In enforce mode the call is blocked (fail closed);
 * otherwise it runs. If even the mode can't be read, enforce is assumed.
 */
export function beforeToolCallFailed(err: unknown): BeforeToolCall {
  logError("before-tool-call", err);
  let mode = modeOverride();
  if (!mode) {
    try {
      mode = getMode();
    } catch {
      mode = "enforce";
    }
  }
  return mode === "enforce" ? { block: gatewayErrorMessage() } : {};
}

export function afterToolCall(call: ToolCall, result: ToolResult): AfterToolCall {
  // 1. Result reduction. A broken strategy must never cost the agent its tool output.
  let reduced: ReduceResult | null = null;
  try {
    reduced = reduceToolResult(call, result.response);
  } catch (err) {
    logError("reduce", err);
  }

  // 2. Log
  completeCall({
    toolUseId: call.toolUseId,
    sessionId: call.sessionId,
    project: call.cwd,
    toolName: call.toolName,
    toolInput: call.toolInput,
    toolResult: result.response,
    promptId: call.promptId,
    transcriptPath: call.transcriptPath,
    agentId: call.agentId ?? null,
    durationMs: typeof result.durationMs === "number" ? result.durationMs : null,
    inputTokens: inputTokens(call.toolInput),
    resultTokens: reduced?.resultTokens ?? null,
    resultTokensAfter: reduced?.resultTokensAfter ?? null,
    savedPotential: reduced?.savedPotential ?? null,
    reduction: reduced?.breakdown.length ? reduced.breakdown : undefined,
    reducedResult: reduced?.response,
  });
  emitEvent({ type: "post", toolUseId: call.toolUseId, sessionId: call.sessionId, toolName: call.toolName });

  const notes = getInputRewrite(call.toolUseId)?.notes ?? [];
  return {
    ...(reduced?.response !== undefined ? { updatedResponse: reduced.response } : {}),
    ...(notes.length ? { additionalContext: notes.join("\n") } : {}),
  };
}

export function onContextReset(sessionId: string): void {
  forgetContext(sessionId);
}

function record(call: ToolCall, check: SecurityCheck, inputRewrite?: unknown): void {
  insertCall({
    toolUseId: call.toolUseId,
    sessionId: call.sessionId,
    project: call.cwd,
    toolName: call.toolName,
    toolInput: call.toolInput,
    promptId: call.promptId,
    transcriptPath: call.transcriptPath,
    agentId: call.agentId ?? null,
    inputTokens: inputTokens(call.toolInput),
    decision: check.decision,
    ruleId: check.ruleId,
    requestId: check.requestId,
    inputRewrite,
  });
  emitEvent({
    type: "pre",
    toolUseId: call.toolUseId,
    sessionId: call.sessionId,
    toolName: call.toolName,
    decision: check.decision,
    ruleId: check.ruleId,
    requestId: check.requestId,
  });
}
