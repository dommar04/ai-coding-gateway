import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { GATEWAY_DIR } from "../storage/database";

/** Appends to ~/.apichap-gateway/errors.log. Never throws: logging must not break a tool call. */
export function logError(context: string, err: unknown): void {
  try {
    const line = `${new Date().toISOString()} [${context}] ${err instanceof Error ? err.stack : String(err)}\n`;
    appendFileSync(join(GATEWAY_DIR, "errors.log"), line);
  } catch {
    // Last resort: nothing we can do without risking breaking the hook.
  }
}
