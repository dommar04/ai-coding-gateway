import { createHash } from "node:crypto";
import { join } from "node:path";
import { adapterFor, type TextField } from "./adapters";
import { OUTPUT_STRATEGIES, type OutputContext, type StrategyState } from "./strategies";
import { estimateTokens } from "./tokens";

// Runs the output strategies that are "on" over a tool result, in order; the outcome is what Claude receives.

export interface ReadCache {
  lastRead(readKey: string): { hash: string; at: string; toolUseId: string | null } | null;
  rememberRead(readKey: string, hash: string): void;
  callIdFor(toolUseId: string | null): number | null;
}

export interface ReduceInput {
  toolName: string;
  toolInput: unknown;
  toolResponse: unknown;
  toolUseId: string;
  states: Map<string, StrategyState>;
  spillDir: string;
  readCache?: ReadCache;
}

export interface StrategyResult {
  id: string;
  saved: number;
}

export interface ReduceResult {
  /** The replaced result, or undefined when Claude should get the original. */
  response?: unknown;
  resultTokens: number;
  resultTokensAfter: number;
  breakdown: StrategyResult[];
}

function readKey(toolInput: unknown): string | null {
  const input = (toolInput ?? {}) as Record<string, unknown>;
  if (typeof input.file_path !== "string") return null;
  return `${input.file_path}|${input.offset ?? ""}|${input.limit ?? ""}`;
}

export function reduceResult(args: ReduceInput): ReduceResult {
  const adapter = adapterFor(args.toolName);
  const resultTokens = adapter.visibleTokens(args.toolResponse);
  const fields = adapter.fields(args.toolResponse);
  const unchanged: ReduceResult = { resultTokens, resultTokensAfter: resultTokens, breakdown: [] };
  if (fields.length === 0) return unchanged;
  const stateOf = (s: (typeof OUTPUT_STRATEGIES)[number]) => args.states.get(s.id) ?? s.defaultState;

  // Repeated-read needs to know whether this exact content was already seen in this session.
  let previousRead: OutputContext["previousRead"] = null;
  const key = args.toolName === "Read" ? readKey(args.toolInput) : null;
  const repeatedRead = OUTPUT_STRATEGIES.find((s) => s.id === "repeated-read");
  if (key && args.readCache && repeatedRead && stateOf(repeatedRead) === "on") {
    const content = fields.find((f) => f.name === "content")?.text ?? "";
    const hash = createHash("sha1").update(content).digest("hex");
    const last = args.readCache.lastRead(key);
    if (last && last.hash === hash) previousRead = { at: last.at, callId: args.readCache.callIdFor(last.toolUseId) };
    // Only the first read counts as "seen": keep its time and call as the reference.
    if (!previousRead) args.readCache.rememberRead(key, hash);
  }

  const totals = new Map<string, StrategyResult>();
  const outFields: TextField[] = [];

  for (const field of fields) {
    let text = field.text;
    for (const s of OUTPUT_STRATEGIES) {
      if (stateOf(s) !== "on" || !s.applies(args.toolName, field.name)) continue;
      const ctx: OutputContext = {
        toolName: args.toolName,
        toolInput: args.toolInput,
        field: field.name,
        toolUseId: args.toolUseId,
        spillDir: args.spillDir,
        previousRead,
      };
      const next = s.apply(text, ctx);
      const saved = estimateTokens(text) - estimateTokens(next);
      text = next;

      if (saved > 0) {
        const t = totals.get(s.id) ?? { id: s.id, saved: 0 };
        t.saved += saved;
        totals.set(s.id, t);
      }
    }
    outFields.push({ name: field.name, text });
  }

  const changed = outFields.some((f, i) => f.text !== fields[i].text);
  const response = changed ? adapter.withFields(args.toolResponse, outFields) : undefined;
  const resultTokensAfter = changed ? adapter.visibleTokens(response) : resultTokens;

  return { response, resultTokens, resultTokensAfter, breakdown: [...totals.values()] };
}

export function spillDirFor(gatewayDir: string): string {
  return join(gatewayDir, "spill");
}
