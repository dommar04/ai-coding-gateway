import { sql } from "../database";

// Table reduction_stats: per reduction strategy, how many calls it changed and how many tokens it
// saved ("on") or would have saved ("measure").

export interface StrategyStatsRow {
  strategy_id: string;
  calls: number;
  saved_tokens: number;
  measured_tokens: number;
}

export function addStrategySavings(strategyId: string, savedTokens: number, measuredTokens: number): void {
  sql(
    `INSERT INTO reduction_stats (strategy_id, calls, saved_tokens, measured_tokens) VALUES (?, 1, ?, ?)
     ON CONFLICT (strategy_id) DO UPDATE SET calls = calls + 1, saved_tokens = saved_tokens + excluded.saved_tokens,
       measured_tokens = measured_tokens + excluded.measured_tokens`
  ).run(strategyId, savedTokens, measuredTokens);
}

export function listStrategyStats(): StrategyStatsRow[] {
  return sql(`SELECT * FROM reduction_stats`).all() as unknown as StrategyStatsRow[];
}
