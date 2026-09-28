import { sql } from "../database";

// Table tool_rules: allow and deny rules, each in a rule group (rule_groups). (effect, rule) is unique.
// A rule counts only when it and its group are both enabled.

export interface RuleRow {
  id: number;
  effect: "allow" | "deny";
  rule: string;
  note: string | null;
  enabled: number;
  source: string;
  created_at: string;
  created_by: string | null;
  group_id: number | null;
  /** Joined from rule_groups. */
  group_title: string | null;
  group_enabled: number | null;
}

export interface NewRule {
  effect: "allow" | "deny";
  rule: string;
  note: string | null;
  enabled?: boolean;
  source: string;
  createdBy: string;
  groupId: number;
}

const SELECT = `SELECT r.*, g.title AS group_title, g.enabled AS group_enabled
  FROM tool_rules r LEFT JOIN rule_groups g ON g.id = r.group_id`;
const ACTIVE = `r.enabled = 1 AND COALESCE(g.enabled, 1) = 1`;

export function listRules(options: { enabledOnly?: boolean } = {}): RuleRow[] {
  return (options.enabledOnly
    ? sql(`${SELECT} WHERE ${ACTIVE} ORDER BY r.effect DESC, r.id`).all()
    : sql(`${SELECT} ORDER BY r.effect DESC, r.id`).all()) as unknown as RuleRow[];
}

export function getRule(id: number): RuleRow | undefined {
  return sql(`${SELECT} WHERE r.id = ?`).get(id) as unknown as RuleRow | undefined;
}

export function countEnabledRules(): number {
  return (
    sql(`SELECT COUNT(*) AS n FROM tool_rules r LEFT JOIN rule_groups g ON g.id = r.group_id WHERE ${ACTIVE}`).get() as {
      n: number;
    }
  ).n;
}

export function countRules(): number {
  return (sql(`SELECT COUNT(*) AS n FROM tool_rules`).get() as { n: number }).n;
}

/** Inserts a rule. Returns its id, or null when the same effect + rule already exists. */
export function insertRule(r: NewRule): number | null {
  const row = sql(
    `INSERT INTO tool_rules (effect, rule, note, enabled, source, created_at, created_by, group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (effect, rule) DO NOTHING RETURNING id`
  ).get(r.effect, r.rule, r.note, r.enabled === false ? 0 : 1, r.source, new Date().toISOString(), r.createdBy, r.groupId) as
    { id: number } | undefined;
  return row?.id ?? null;
}

/**
 * Inserts a rule, or re-enables it if it already exists. Returns its id. An existing rule sitting
 * in a switched-off group moves to the given group, so the rule really takes effect.
 */
export function upsertEnabledRule(r: NewRule): number {
  const row = sql(
    `INSERT INTO tool_rules (effect, rule, note, enabled, source, created_at, created_by, group_id) VALUES (?, ?, ?, 1, ?, ?, ?, ?)
     ON CONFLICT (effect, rule) DO UPDATE SET enabled = 1,
       group_id = CASE WHEN (SELECT enabled FROM rule_groups WHERE id = tool_rules.group_id) = 1 THEN group_id ELSE excluded.group_id END
     RETURNING id`
  ).get(r.effect, r.rule, r.note, r.source, new Date().toISOString(), r.createdBy, r.groupId) as { id: number };
  return row.id;
}

export function setRuleEnabled(id: number, enabled: boolean): boolean {
  return sql(`UPDATE tool_rules SET enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id).changes > 0;
}

export function setRuleGroup(id: number, groupId: number): boolean {
  return sql(`UPDATE tool_rules SET group_id = ? WHERE id = ?`).run(groupId, id).changes > 0;
}

export function deleteRule(id: number): boolean {
  return sql(`DELETE FROM tool_rules WHERE id = ?`).run(id).changes > 0;
}

export function deleteAllRules(): number {
  return Number(sql(`DELETE FROM tool_rules`).run().changes);
}
