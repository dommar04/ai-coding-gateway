import { beforeToolCall, beforeToolCallFailed, afterToolCall, onContextReset } from "../../services/gateway";
import { logError } from "../../helpers/errors";
import type { Integration } from "..";
import { readHookInput, reply } from "./hook-io";
import { recordPrompt } from "../../storage/tables/prompts";
export async function runIntegrationHook(phase: string, integration: Integration): Promise<void> {
  if (phase === "pre") {
    let outcome;
    try {
      outcome = beforeToolCall(integration.toToolCall(await readHookInput()));
    } catch (err) {
      outcome = beforeToolCallFailed(err);
    }
    reply(integration.preReply(outcome));
  } else if (phase === "post") {
    try {
      const input = await readHookInput<{ tool_response?: unknown; duration_ms?: number }>();
      const outcome = afterToolCall(
        integration.toToolCall(input),
        { response: input.tool_response, durationMs: input.duration_ms },
        integration.capabilities
      );
      reply(integration.postReply(outcome));
    } catch (err) {
      logError("hook:post", err);
      reply();
    }
  } else if (phase === "prompt") {
    try {
      const input = await readHookInput();
      if (integration.toPrompt) recordPrompt(integration.toPrompt(input));
    } catch (err) {
      logError("hook:prompt", err);
    }
    reply();
  } else {
    try {
      const input = await readHookInput<{ session_id?: string; hook_event_name?: string; source?: string }>();
      if (input.session_id && (input.hook_event_name === "PreCompact" || input.source === "compact" || input.source === "clear"))
        onContextReset(input.session_id);
    } catch (err) {
      logError("hook:session", err);
    }
    reply();
  }
}
