import { logError } from "../../../helpers/errors";
import { onContextReset } from "../../../services/gateway";
import type { ClaudeSessionHookInput } from "../hook-input";
import { readHookInput, reply } from "./hook-io";

// PreCompact / SessionStart: after compaction or /clear, Claude no longer has earlier file reads in context.

export async function runContextReset(): Promise<void> {
  try {
    const input = await readHookInput<ClaudeSessionHookInput>();
    const resets = input.hook_event_name === "PreCompact" || input.source === "compact" || input.source === "clear";
    if (resets && input.session_id) onContextReset(input.session_id);
  } catch (err) {
    logError("hook:session", err);
  }
  reply();
}
