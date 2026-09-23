import { logError } from "../../../helpers/errors";
import { afterToolCall } from "../../../services/gateway";
import { toToolCall, type ClaudeToolHookInput } from "../hook-input";
import { readHookInput, reply } from "./hook-io";

// PostToolUse: the tool ran. The gateway logs it and may hand Claude a shortened result.

export async function runPostToolUse(): Promise<void> {
  try {
    const input = await readHookInput<ClaudeToolHookInput>();
    const outcome = afterToolCall(toToolCall(input), { response: input.tool_response, durationMs: input.duration_ms });
    const output: Record<string, unknown> = { hookEventName: "PostToolUse" };
    // Claude Code only accepts a replaced result in the tool's own shape, which the reduction keeps.
    if (outcome.updatedResponse !== undefined) output.updatedToolOutput = outcome.updatedResponse;
    if (outcome.additionalContext) output.additionalContext = outcome.additionalContext;
    reply(Object.keys(output).length > 1 ? output : undefined);
  } catch (err) {
    // The call already ran: fail open.
    logError("hook:post", err);
    reply();
  }
}
