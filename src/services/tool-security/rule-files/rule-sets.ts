import { transaction } from "../../../storage/database";
import { getSetting, setSetting } from "../../../storage/tables/settings";
import { countRules, deleteAllRules, insertRule, listRules } from "../../../storage/tables/tool-rules";
import { currentUser } from "../../../helpers/user";
import { assertLocalPolicy } from "../../settings";
import { loadDefaultRuleFile, normalizeRuleFile, type RuleEntry, type RuleFile } from "./rule-file";

// Import, export and reset of the whole rule set.

export type ImportMode = "replace" | "merge";

export interface ImportResult {
  mode: ImportMode;
  added: number;
  removed: number;
  total: number;
}

/**
 * replace: all existing rules are deleted and the file's rules take their place.
 * merge:   only rules not yet present (same effect and rule text) are added.
 * All-or-nothing: the file is fully validated before anything changes.
 */
export function importRules(file: unknown, mode: ImportMode, source = "import"): ImportResult {
  assertLocalPolicy("import rules");
  const rules = normalizeRuleFile(file);
  const createdBy = currentUser();
  return transaction(() => {
    const removed = mode === "replace" ? deleteAllRules() : 0;
    let added = 0;
    for (const r of rules) {
      if (insertRule({ effect: r.effect, rule: r.rule, note: r.note, enabled: r.enabled, source, createdBy }) !== null) added++;
    }
    return { mode, added, removed, total: countRules() };
  });
}

/** Imports rules/default-rules.json and remembers its version. */
export function resetToDefaults(mode: ImportMode): ImportResult {
  const file = loadDefaultRuleFile();
  const result = importRules(file, mode, "default");
  setSetting("defaults_version", String(file.version ?? 0));
  return result;
}

export function defaultsStatus(): { name: string; version: number; rules: number; importedVersion: number } {
  const file = loadDefaultRuleFile();
  return {
    name: file.name ?? "default rules",
    version: file.version ?? 0,
    rules: (file.allow?.length ?? 0) + (file.deny?.length ?? 0),
    importedVersion: Number(getSetting("defaults_version") ?? 0),
  };
}

/** The current rules in the rule-file format (importable again). */
export function exportRules(): RuleFile & { exportedAt: string } {
  const rows = listRules().sort((a, b) => a.id - b.id);
  const entry = (r: (typeof rows)[number]): RuleEntry => {
    // Always an object, so every entry has the same shape (see rules/rule-file.schema.json).
    return { rule: r.rule, ...(r.note ? { note: r.note } : {}), ...(r.enabled ? {} : { enabled: false }) };
  };
  return {
    name: "apichap AI Coding Gateway rules",
    version: 1,
    exportedAt: new Date().toISOString(),
    allow: rows.filter((r) => r.effect === "allow").map(entry),
    deny: rows.filter((r) => r.effect === "deny").map(entry),
  };
}

/** Rule file as JSON text with one rule per line, easy to read and diff. */
export function formatRuleFile(file: RuleFile & { exportedAt?: string }): string {
  const line = (e: RuleEntry) =>
    `    ${JSON.stringify(e)
      .replace(/^\{"rule":/, '{ "rule": ')
      .replace(/,"note":/, ', "note": ')
      .replace(/,"enabled":/, ', "enabled": ')
      .replace(/\}$/, " }")}`;
  const list = (xs: RuleEntry[] = []) => (xs.length ? `[\n${xs.map(line).join(",\n")}\n  ]` : "[]");
  const head = Object.entries(file)
    .filter(([k]) => k !== "allow" && k !== "deny")
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return `{\n${[...head, `  "allow": ${list(file.allow)}`, `  "deny": ${list(file.deny)}`].join(",\n")}\n}\n`;
}
