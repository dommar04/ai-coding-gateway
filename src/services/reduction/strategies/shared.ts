// Output reduction strategies: each takes the text Claude would see and returns a shorter version.
// Every strategy can be switched on or off in the dashboard. They run in the order listed.
// Read results are never rewritten in content (Claude needs exact file text to edit), except by
// "repeated-read", which replaces an unchanged re-read with a short note.

export type StrategyState = "on" | "off";

export interface OutputContext {
  toolName: string;
  toolInput: unknown;
  /** Which text field of the result this is (stdout, stderr, content, result, blockN). */
  field: string;
  toolUseId: string;
  spillDir: string;
  /** For repeated-read: when this exact content was last seen in this session, or null. */
  previousRead?: { at: string; callId: number | null } | null;
}

export interface OutputStrategy {
  id: string;
  title: string;
  description: string;
  group: "Lossless cleanup" | "Condense noisy output" | "Long output" | "Repeated content";
  defaultState: StrategyState;
  applies(toolName: string, field: string): boolean;
  apply(text: string, ctx: OutputContext): string;
}

export const SHELL = new Set(["Bash", "PowerShell"]);
export const isShell = (t: string) => SHELL.has(t);
export const isMcp = (t: string) => t.startsWith("mcp__");
/** Every rewritable text except Read content. */
export const notRead = (t: string) => t !== "Read";

export const NOTE = "[apichap gateway]";
/** A condensing strategy only acts when it removes at least this many lines (the note it adds costs ~12 tokens). */
export const MIN_DROPPED = 3;
