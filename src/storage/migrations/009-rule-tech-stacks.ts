import { loadDefaultRuleFile, normalizeRuleFile } from "../../services/tool-security/rule-files/rule-file";
import type { Migration } from "./types";

// Rules carry the tech stacks they are for (JSON list, NULL = all). Default rules get theirs from
// rules/default-rules.json; every other rule stays NULL.

export const ruleTechStacks: Migration = {
  id: "009-rule-tech-stacks",
  up(db) {
    db.exec(`ALTER TABLE tool_rules ADD COLUMN tech_stacks TEXT`);
    const set = db.prepare(`UPDATE tool_rules SET tech_stacks = ? WHERE effect = ? AND rule = ? AND source = 'default'`);
    for (const r of normalizeRuleFile(loadDefaultRuleFile()))
      if (r.techStacks) set.run(JSON.stringify(r.techStacks), r.effect, r.rule);
  },
};
