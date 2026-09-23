import type { CallDecision, ToolCall } from "../../entities/tool-call";
import type { Mode } from "../settings";
import { denyMessage } from "./messages";
import { fileRequest } from "./requests";
import { evaluateCall } from "./rules";

// Tool security: is this tool call allowed by the rules? Unlisted calls become approval requests.

export interface SecurityCheck {
  decision: CallDecision;
  /** The rule that decided (the deny rule, or the allow rule that covered the call). */
  ruleId: number | null;
  /** The approval request filed for an unlisted call. */
  requestId: number | null;
  /** What the agent is told when the call is blocked (enforce mode only). */
  message: string | null;
}

export function checkToolSecurity(call: ToolCall, mode: Exclude<Mode, "off">): SecurityCheck {
  const verdict = evaluateCall(call.toolName, call.toolInput, call.cwd);
  if (verdict.decision === "allow") {
    return { decision: "allowed", ruleId: verdict.parts[0]?.allowedBy?.id ?? null, requestId: null, message: null };
  }
  const requestId =
    verdict.reason === "unlisted"
      ? fileRequest({ toolName: call.toolName, toolInput: call.toolInput, cwd: call.cwd, sessionId: call.sessionId, verdict })
      : null;
  const ruleId = verdict.reason === "rule" ? verdict.rule.id : null;
  if (mode === "enforce")
    return { decision: "denied", ruleId, requestId, message: denyMessage(call.toolName, verdict, requestId) };
  return { decision: "would_deny", ruleId, requestId, message: null };
}
