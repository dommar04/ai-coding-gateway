import { loadDefaultRuleFile, normalizeRuleFile } from "../../services/tool-security/rule-files/rule-file";
import type { Migration } from "./types";

// A new database starts with the default rules (rules/default-rules.json) in monitor mode.
// Later versions of the default rules are offered on the dashboard, never applied automatically.

export const defaultRules: Migration = {
  id: "002-default-rules",
  up(db) {
    const file = loadDefaultRuleFile();
    const now = new Date().toISOString();
    const insert = db.prepare(
      `INSERT INTO tool_rules (effect, rule, note, enabled, source, created_at, created_by) VALUES (?, ?, ?, ?, 'default', ?, 'default')`
    );
    for (const r of normalizeRuleFile(file)) insert.run(r.effect, r.rule, r.note, r.enabled ? 1 : 0, now);
    const setting = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`);
    setting.run("defaults_version", String(file.version ?? 0));
    setting.run("mode", "monitor");
  },
};
