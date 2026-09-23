import { beforeToolCall, beforeToolCallFailed, type BeforeToolCall } from "../../../services/gateway";
import { toToolCall, type ClaudeToolHookInput } from "../hook-input";
import { readHookInput, reply } from "./hook-io";

// PreToolUse: Claude Code asks before every tool call. The gateway may block it or shrink its input.

export async function runPreToolUse(): Promise<void> {
  let outcome: BeforeToolCall;
  try {
    outcome = beforeToolCall(toToolCall(await readHookInput<ClaudeToolHookInput>()));
  } catch (err) {
    outcome = beforeToolCallFailed(err);
  }
  if (outcome.block) {
    reply({ hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: outcome.block });
  } else if (outcome.updatedInput) {
    // No permissionDecision: Claude Code's own permission prompts still apply.
    reply({ hookEventName: "PreToolUse", updatedInput: outcome.updatedInput });
  } else {
    reply();
  }
}
