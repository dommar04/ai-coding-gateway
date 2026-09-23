import { sql } from "../database";

// Table tool_rules: allow and deny rules. (effect, rule) is unique.

export interface RuleRow {
  id: number;
  effect: "allow" | "deny";
  rule: string;
  note: string | null;
  enabled: number;
  source: string;
  created_at: string;
  created_by: string | null;
}

export interface NewRule {
  effect: "allow" | "deny";
  rule: string;
  note: string | null;
  enabled?: boolean;
  source: string;
  createdBy: string;
}

export function listRules(options: { enabledOnly?: boolean } = {}): RuleRow[] {
  return (options.enabledOnly
    ? sql(`SELECT * FROM tool_rules WHERE enabled = 1 ORDER BY effect DESC, id`).all()
    : sql(`SELECT * FROM tool_rules ORDER BY effect DESC, id`).all()) as unknown as RuleRow[];
}

export function getRule(id: number): RuleRow | undefined {
  return sql(`SELECT * FROM tool_rules WHERE id = ?`).get(id) as unknown as RuleRow | undefined;
}

export function countEnabledRules(): number {
  return (sql(`SELECT COUNT(*) AS n FROM tool_rules WHERE enabled = 1`).get() as { n: number }).n;
}

export function countRules(): number {
  return (sql(`SELECT COUNT(*) AS n FROM tool_rules`).get() as { n: number }).n;
}

/** Inserts a rule. Returns its id, or null when the same effect + rule already exists. */
export function insertRule(r: NewRule): number | null {
  const row = sql(
    `INSERT INTO tool_rules (effect, rule, note, enabled, source, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (effect, rule) DO NOTHING RETURNING id`
  ).get(r.effect, r.rule, r.note, r.enabled === false ? 0 : 1, r.source, new Date().toISOString(), r.createdBy) as
    { id: number } | undefined;
  return row?.id ?? null;
}

/** Inserts a rule, or re-enables it if it already exists. Returns its id. */
export function upsertEnabledRule(r: NewRule): number {
  const row = sql(
    `INSERT INTO tool_rules (effect, rule, note, enabled, source, created_at, created_by) VALUES (?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT (effect, rule) DO UPDATE SET enabled = 1 RETURNING id`
  ).get(r.effect, r.rule, r.note, r.source, new Date().toISOString(), r.createdBy) as { id: number };
  return row.id;
}

export function setRuleEnabled(id: number, enabled: boolean): boolean {
  return sql(`UPDATE tool_rules SET enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id).changes > 0;
}

export function deleteRule(id: number): boolean {
  return sql(`DELETE FROM tool_rules WHERE id = ?`).run(id).changes > 0;
}

export function deleteAllRules(): number {
  return Number(sql(`DELETE FROM tool_rules`).run().changes);
}
