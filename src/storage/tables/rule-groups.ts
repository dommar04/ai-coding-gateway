import { sql } from "../database";

// Table rule_groups: one policy in plain words ("The agent is not allowed to delete files").
// Its rules live in tool_rules (group_id); deleting a group deletes its rules. key is unique.

export interface GroupRow {
  id: number;
  key: string;
  title: string;
  description: string | null;
  enabled: number;
  position: number;
  source: string;
  created_at: string;
  created_by: string | null;
}

export interface NewGroup {
  key: string;
  title: string;
  description: string | null;
  enabled?: boolean;
  source: string;
  createdBy: string;
}

export function listGroups(): GroupRow[] {
  return sql(`SELECT * FROM rule_groups ORDER BY position, id`).all() as unknown as GroupRow[];
}

export function getGroup(id: number): GroupRow | undefined {
  return sql(`SELECT * FROM rule_groups WHERE id = ?`).get(id) as unknown as GroupRow | undefined;
}

export function getGroupByKey(key: string): GroupRow | undefined {
  return sql(`SELECT * FROM rule_groups WHERE key = ?`).get(key) as unknown as GroupRow | undefined;
}

export function countGroups(): number {
  return (sql(`SELECT COUNT(*) AS n FROM rule_groups`).get() as { n: number }).n;
}

/** Inserts a group at the end of the list. Returns its id. */
export function insertGroup(g: NewGroup): number {
  const row = sql(
    `INSERT INTO rule_groups (key, title, description, enabled, position, source, created_at, created_by)
     VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM rule_groups), ?, ?, ?) RETURNING id`
  ).get(g.key, g.title, g.description, g.enabled === false ? 0 : 1, g.source, new Date().toISOString(), g.createdBy) as {
    id: number;
  };
  return row.id;
}

export function updateGroup(id: number, patch: { title?: string; description?: string | null; enabled?: boolean }): boolean {
  const row = getGroup(id);
  if (!row) return false;
  sql(`UPDATE rule_groups SET title = ?, description = ?, enabled = ? WHERE id = ?`).run(
    patch.title ?? row.title,
    patch.description !== undefined ? patch.description : row.description,
    patch.enabled === undefined ? row.enabled : patch.enabled ? 1 : 0,
    id
  );
  return true;
}

/** Deletes the group and, by cascade, its rules. */
export function deleteGroup(id: number): boolean {
  return sql(`DELETE FROM rule_groups WHERE id = ?`).run(id).changes > 0;
}

export function deleteAllGroups(): number {
  return Number(sql(`DELETE FROM rule_groups`).run().changes);
}
