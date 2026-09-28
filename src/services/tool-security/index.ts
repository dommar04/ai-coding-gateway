import type { CallDecision, ToolCall } from "../../entities/tool-call";
import type { Mode } from "../settings";
import { denyMessage } from "./messages";
import { evaluateCall } from "./rules";

// Tool security: is this tool call allowed by the rules? Unlisted calls are denied too.

export interface SecurityCheck {
  decision: CallDecision;
  /** The rule that decided (the deny rule, or the allow rule that covered the call). */
  ruleId: number | null;
  /** What the agent is told when the call is denied (enforce mode only). */
  message: string | null;
}

export function checkToolSecurity(call: ToolCall, mode: Exclude<Mode, "off">): SecurityCheck {
  const verdict = evaluateCall(call.toolName, call.toolInput, call.cwd);
  if (verdict.decision === "allow") {
    return { decision: "allowed", ruleId: verdict.parts[0]?.allowedBy?.id ?? null, message: null };
  }
  const ruleId = verdict.reason === "rule" ? verdict.rule.id : null;
  if (mode === "enforce") return { decision: "denied", ruleId, message: denyMessage(call.toolName, verdict) };
  return { decision: "would_deny", ruleId, message: null };
}
