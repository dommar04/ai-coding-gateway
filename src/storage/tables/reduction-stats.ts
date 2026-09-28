import { sql } from "../database";

// Table reduction_stats: per reduction strategy, how many calls it changed and how many tokens it saved.

export interface StrategyStatsRow {
  strategy_id: string;
  calls: number;
  saved_tokens: number;
}

export function addStrategySavings(strategyId: string, savedTokens: number): void {
  sql(
    `INSERT INTO reduction_stats (strategy_id, calls, saved_tokens) VALUES (?, 1, ?)
     ON CONFLICT (strategy_id) DO UPDATE SET calls = calls + 1, saved_tokens = saved_tokens + excluded.saved_tokens`
  ).run(strategyId, savedTokens);
}

export function listStrategyStats(): StrategyStatsRow[] {
  return sql(`SELECT * FROM reduction_stats`).all() as unknown as StrategyStatsRow[];
}
