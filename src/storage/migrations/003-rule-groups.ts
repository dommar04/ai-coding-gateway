import { BUILTIN_GROUPS, loadDefaultRuleFile, parseRuleFile } from "../../services/tool-security/rule-files/rule-file";
import type { Migration } from "./types";

// Rule groups: every rule moves into a group that says in plain words what it is for.
// Rules that are in the default rules join their default group; approved rules, older default
// rules and hand-added rules get a group of their own. No rules are added or removed.

export const ruleGroups: Migration = {
  id: "003-rule-groups",
  up(db) {
    db.exec(`
      CREATE TABLE rule_groups (
        id          INTEGER PRIMARY KEY,
        key         TEXT NOT NULL UNIQUE,
        title       TEXT NOT NULL,
        description TEXT,
        enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        position    INTEGER NOT NULL DEFAULT 0,
        source      TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        created_by  TEXT
      ) STRICT;
      ALTER TABLE tool_rules ADD COLUMN group_id INTEGER REFERENCES rule_groups (id) ON DELETE CASCADE;
      CREATE INDEX idx_tool_rules_group_id ON tool_rules (group_id);
    `);

    const defaults = parseRuleFile(loadDefaultRuleFile());
    const defaultGroupOf = new Map<string, string>();
    for (const g of defaults) for (const r of g.rules) defaultGroupOf.set(`${r.effect}\n${r.rule}`, g.key);

    const rows = db.prepare(`SELECT id, effect, rule, source FROM tool_rules ORDER BY id`).all() as Array<{
      id: number;
      effect: string;
      rule: string;
      source: string;
    }>;
    const groupOf = (r: (typeof rows)[number]) =>
      defaultGroupOf.get(`${r.effect}\n${r.rule}`) ??
      (r.source === "approved"
        ? BUILTIN_GROUPS.approved.key
        : r.source === "default"
          ? BUILTIN_GROUPS.previousDefaults.key
          : BUILTIN_GROUPS.custom.key);
    const used = new Set(rows.map(groupOf));

    const candidates = [
      ...defaults.map((g) => ({ key: g.key, title: g.title, description: g.description, source: "default" })),
      ...[BUILTIN_GROUPS.approved, BUILTIN_GROUPS.previousDefaults, BUILTIN_GROUPS.custom].map((g) => ({
        ...g,
        source: "gateway",
      })),
    ];
    const now = new Date().toISOString();
    const insertGroup = db.prepare(
      `INSERT INTO rule_groups (key, title, description, enabled, position, source, created_at, created_by)
       VALUES (?, ?, ?, 1, ?, ?, ?, 'migration') RETURNING id`
    );
    const ids = new Map<string, number>();
    for (const g of candidates.filter((c) => used.has(c.key))) {
      const { id } = insertGroup.get(g.key, g.title, g.description, ids.size, g.source, now) as { id: number };
      ids.set(g.key, id);
    }

    const assign = db.prepare(`UPDATE tool_rules SET group_id = ? WHERE id = ?`);
    for (const r of rows) assign.run(ids.get(groupOf(r))!, r.id);
  },
};
