import { listSettings, setSetting } from "../../storage/tables/settings";
import { addStrategySavings, listStrategyStats } from "../../storage/tables/reduction-stats";
import { assertLocalPolicy } from "../settings";
import { INPUT_STRATEGIES } from "./input-strategies";
import { OUTPUT_STRATEGIES, type StrategyState } from "./strategies";

// The reduction options: every output and input strategy with its on / measure / off state
// (settings "reduction:<id>") and what it has saved so far.

export interface StrategyInfo {
  id: string;
  title: string;
  description: string;
  group: string;
  kind: "output" | "input";
  states: StrategyState[];
  state: StrategyState;
  defaultState: StrategyState;
  calls: number;
  savedTokens: number;
  measuredTokens: number;
}

const ALL = [
  ...OUTPUT_STRATEGIES.map((s) => ({ ...s, kind: "output" as const, states: ["on", "measure", "off"] as StrategyState[] })),
  ...INPUT_STRATEGIES.map((s) => ({ ...s, kind: "input" as const, states: ["on", "off"] as StrategyState[] })),
];

const SETTING_PREFIX = "reduction:";

export function strategyStates(): Map<string, StrategyState> {
  const stored = listSettings(SETTING_PREFIX);
  return new Map(
    ALL.map((s) => {
      const value = stored.get(s.id) as StrategyState | undefined;
      return [s.id, value && s.states.includes(value) ? value : s.defaultState];
    })
  );
}

export function setStrategyState(id: string, state: StrategyState): void {
  assertLocalPolicy("change token reduction settings");
  const strategy = ALL.find((s) => s.id === id);
  if (!strategy) throw new Error(`Unknown reduction option "${id}".`);
  if (!strategy.states.includes(state)) throw new Error(`"${id}" can only be ${strategy.states.join(" / ")}.`);
  setSetting(SETTING_PREFIX + id, state);
}

export function listStrategies(): StrategyInfo[] {
  const states = strategyStates();
  const stats = new Map(listStrategyStats().map((r) => [r.strategy_id, r]));
  return ALL.map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    group: s.group,
    kind: s.kind,
    states: s.states,
    state: states.get(s.id)!,
    defaultState: s.defaultState,
    calls: stats.get(s.id)?.calls ?? 0,
    savedTokens: stats.get(s.id)?.saved_tokens ?? 0,
    measuredTokens: stats.get(s.id)?.measured_tokens ?? 0,
  }));
}

export function recordStrategySavings(breakdown: Array<{ id: string; state: StrategyState; saved: number }>): void {
  for (const b of breakdown) {
    if (b.saved <= 0) continue;
    addStrategySavings(b.id, b.state === "on" ? b.saved : 0, b.state === "measure" ? b.saved : 0);
  }
}
