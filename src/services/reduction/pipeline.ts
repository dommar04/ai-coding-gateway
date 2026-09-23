import { createHash } from "node:crypto";
import { join } from "node:path";
import { adapterFor, type TextField } from "./adapters";
import { OUTPUT_STRATEGIES, type OutputContext, type StrategyState } from "./strategies";
import { estimateTokens } from "./tokens";

// Runs the output strategies over a tool result. Two passes over the same text:
//  - actual:    only strategies set to "on"; this is what Claude receives
//  - potential: "on" + "measure"; what Claude would receive with everything enabled
// Measure-mode strategies never have side effects (no spill files).

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
  state: StrategyState;
  saved: number;
}

export interface ReduceResult {
  /** The replaced result, or undefined when Claude should get the original. */
  response?: unknown;
  resultTokens: number;
  resultTokensAfter: number;
  /** Additional tokens the "measure" strategies would save. */
  savedPotential: number;
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
  const unchanged: ReduceResult = { resultTokens, resultTokensAfter: resultTokens, savedPotential: 0, breakdown: [] };
  if (fields.length === 0) return unchanged;

  // Repeated-read needs to know whether this exact content was already seen in this session.
  let previousRead: OutputContext["previousRead"] = null;
  const key = args.toolName === "Read" ? readKey(args.toolInput) : null;
  if (key && args.readCache && args.states.get("repeated-read") !== "off") {
    const content = fields.find((f) => f.name === "content")?.text ?? "";
    const hash = createHash("sha1").update(content).digest("hex");
    const last = args.readCache.lastRead(key);
    if (last && last.hash === hash) previousRead = { at: last.at, callId: args.readCache.callIdFor(last.toolUseId) };
    // Only the first read counts as "seen": keep its time and call as the reference.
    if (!previousRead) args.readCache.rememberRead(key, hash);
  }

  const totals = new Map<string, StrategyResult>();
  const actualFields: TextField[] = [];
  const potentialFields: TextField[] = [];

  for (const field of fields) {
    let actual = field.text;
    let potential = field.text;
    for (const s of OUTPUT_STRATEGIES) {
      const state = args.states.get(s.id) ?? s.defaultState;
      if (state === "off" || !s.applies(args.toolName, field.name)) continue;
      const ctx = (dryRun: boolean): OutputContext => ({
        toolName: args.toolName,
        toolInput: args.toolInput,
        field: field.name,
        toolUseId: args.toolUseId,
        dryRun,
        spillDir: args.spillDir,
        previousRead,
      });

      let saved = 0;
      if (state === "on") {
        const next = s.apply(actual, ctx(false));
        saved = estimateTokens(actual) - estimateTokens(next);
        actual = next;
      }
      const nextPotential = s.apply(potential, ctx(true));
      if (state === "measure") saved = estimateTokens(potential) - estimateTokens(nextPotential);
      potential = nextPotential;

      if (saved > 0) {
        const t = totals.get(s.id) ?? { id: s.id, state, saved: 0 };
        t.saved += saved;
        totals.set(s.id, t);
      }
    }
    actualFields.push({ name: field.name, text: actual });
    potentialFields.push({ name: field.name, text: potential });
  }

  const changed = actualFields.some((f, i) => f.text !== fields[i].text);
  const response = changed ? adapter.withFields(args.toolResponse, actualFields) : undefined;
  const resultTokensAfter = changed ? adapter.visibleTokens(response) : resultTokens;
  const potentialTokens = adapter.visibleTokens(adapter.withFields(args.toolResponse, potentialFields));

  return {
    response,
    resultTokens,
    resultTokensAfter,
    savedPotential: Math.max(0, resultTokensAfter - potentialTokens),
    breakdown: [...totals.values()],
  };
}

export function spillDirFor(gatewayDir: string): string {
  return join(gatewayDir, "spill");
}
