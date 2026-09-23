import { gitLogLimit } from "./git-log-limit";
import { grepLimit } from "./grep-limit";
import { npmQuiet } from "./npm-quiet";
import { readLimit } from "./read-limit";
import type { InputStrategy } from "./types";

// Input strategies, one per file. Each has an on/off switch on the dashboard's Token savings page.

export type { InputRewrite, InputStrategy } from "./types";
export { READ_LIMIT } from "./read-limit";
export { GREP_LIMIT } from "./grep-limit";
export { GIT_LOG_LIMIT } from "./git-log-limit";

export const INPUT_STRATEGIES: InputStrategy[] = [readLimit, grepLimit, npmQuiet, gitLogLimit];

/** Applies all enabled input strategies in order. Returns null when nothing changed. */
export function rewriteInput(
  toolName: string,
  toolInput: unknown,
  cwd: string,
  isOn: (id: string) => boolean
): { input: Record<string, unknown>; applied: string[]; notes: string[] } | null {
  if (!toolInput || typeof toolInput !== "object") return null;
  let input = toolInput as Record<string, unknown>;
  const applied: string[] = [];
  const notes: string[] = [];
  for (const s of INPUT_STRATEGIES) {
    if (!isOn(s.id) || !s.applies(toolName)) continue;
    const r = s.rewrite(input, cwd);
    if (r) {
      input = r.input;
      applied.push(s.id);
      notes.push(r.note);
    }
  }
  return applied.length ? { input, applied, notes } : null;
}
