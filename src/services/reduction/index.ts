import type { ToolCall } from "../../entities/tool-call";
import { GATEWAY_DIR } from "../../storage/database";
import { deleteSessionReads, getCachedRead, putCachedRead } from "../../storage/tables/read-cache";
import { callIdForToolUse } from "../../storage/tables/tool-calls";
import { rewriteInput } from "./input-strategies";
import { recordStrategySavings, strategyStates } from "./options";
import { reduceResult, spillDirFor, type ReduceResult } from "./pipeline";

// Token reduction: shrink tool calls before they run and tool results before the agent reads them.
// Every strategy has its own on / measure / off setting (see options.ts).

export type { ReduceResult } from "./pipeline";

/** Input strategies that are "on" (limit big reads, quiet npm, ...). Null when nothing changed. */
export function rewriteToolInput(call: ToolCall) {
  const states = strategyStates();
  return rewriteInput(call.toolName, call.toolInput, call.cwd, (id) => states.get(id) === "on");
}

/** Runs the output strategies over a result and records their savings. */
export function reduceToolResult(call: ToolCall, response: unknown): ReduceResult {
  // Sub-agents have their own context: what the main agent read doesn't count for them.
  const sessionKey = call.agentId ? `${call.sessionId}:${call.agentId}` : call.sessionId;
  const result = reduceResult({
    toolName: call.toolName,
    toolInput: call.toolInput,
    toolResponse: response,
    toolUseId: call.toolUseId,
    states: strategyStates(),
    spillDir: spillDirFor(GATEWAY_DIR),
    readCache: {
      lastRead: (key) => {
        const read = getCachedRead(sessionKey, key);
        return read ? { hash: read.hash, at: read.readAt, toolUseId: read.toolUseId } : null;
      },
      rememberRead: (key, hash) => putCachedRead(sessionKey, key, hash, call.toolUseId),
      callIdFor: (toolUseId) => (toolUseId ? callIdForToolUse(toolUseId) : null),
    },
  });
  if (result.breakdown.length) recordStrategySavings(result.breakdown);
  return result;
}

/** The agent's context was compacted or cleared: earlier reads are no longer in it. */
export function forgetContext(sessionId: string): void {
  deleteSessionReads(sessionId);
}
