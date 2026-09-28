import { transaction } from "../../../storage/database";
import { getSetting, setSetting } from "../../../storage/tables/settings";
import { countGroups, deleteAllGroups, getGroupByKey, insertGroup, listGroups } from "../../../storage/tables/rule-groups";
import { countRules, deleteAllRules, insertRule, listRules } from "../../../storage/tables/tool-rules";
import { currentUser } from "../../../helpers/user";
import {
  BUILTIN_GROUPS,
  loadDefaultRuleFile,
  parseRuleFile,
  type NormalizedGroup,
  type RuleEntry,
  type RuleFile,
  type RuleGroupEntry,
} from "./rule-file";

// Import, export and reset of the whole rule set.

export type ImportMode = "replace" | "merge";

export interface ImportResult {
  mode: ImportMode;
  added: number;
  removed: number;
  total: number;
  addedGroups: number;
  groups: number;
}

/**
 * replace: all existing groups and rules are deleted and the file's take their place.
 * merge:   groups are matched by id; missing groups are created, and only rules not yet present
 *          (same effect and rule text, in any group) are added. Existing rules stay where they are.
 * All-or-nothing: the file is fully validated before anything changes.
 */
export function importRules(file: unknown, mode: ImportMode, source = "import"): ImportResult {
  const groups = parseRuleFile(file);
  const createdBy = currentUser();
  return transaction(() => {
    const removed = mode === "replace" ? countRules() : 0;
    if (mode === "replace") {
      deleteAllRules();
      deleteAllGroups();
    }
    let added = 0;
    let addedGroups = 0;
    for (const g of groups) {
      let groupId = getGroupByKey(g.key)?.id;
      if (groupId === undefined) {
        groupId = insertGroup({ key: g.key, title: g.title, description: g.description, enabled: g.enabled, source, createdBy });
        addedGroups++;
      }
      for (const r of g.rules) {
        const id = insertRule({ effect: r.effect, rule: r.rule, note: r.note, enabled: r.enabled, source, createdBy, groupId });
        if (id !== null) added++;
      }
    }
    return { mode, added, removed, total: countRules(), addedGroups, groups: countGroups() };
  });
}

export interface ImportPreview {
  name: string | null;
  description: string | null;
  version: number | null;
  /** The file uses the older format without groups. */
  legacy: boolean;
  groups: Array<{
    key: string;
    title: string;
    description: string | null;
    enabled: boolean;
    allow: number;
    deny: number;
    /** A group with this id exists already (merge adds to it). */
    exists: boolean;
    /** Rules a merge would add. */
    newRules: number;
  }>;
  rules: number;
  newRules: number;
  current: { rules: number; groups: number };
}

/** What importing this file would do, without changing anything. Throws like import on an invalid file. */
export function previewImport(file: unknown): ImportPreview {
  const groups = parseRuleFile(file);
  const f = file as RuleFile;
  const existing = new Set(listRules().map((r) => `${r.effect}\n${r.rule}`));
  const summary = groups.map((g: NormalizedGroup) => ({
    key: g.key,
    title: g.title,
    description: g.description,
    enabled: g.enabled,
    allow: g.rules.filter((r) => r.effect === "allow").length,
    deny: g.rules.filter((r) => r.effect === "deny").length,
    exists: getGroupByKey(g.key) !== undefined,
    newRules: g.rules.filter((r) => !existing.has(`${r.effect}\n${r.rule}`)).length,
  }));
  return {
    name: typeof f.name === "string" ? f.name : null,
    description: typeof f.description === "string" ? f.description : null,
    version: typeof f.version === "number" ? f.version : null,
    legacy: !Array.isArray(f.groups),
    groups: summary,
    rules: summary.reduce((n, g) => n + g.allow + g.deny, 0),
    newRules: summary.reduce((n, g) => n + g.newRules, 0),
    current: { rules: countRules(), groups: countGroups() },
  };
}

/** Imports rules/default-rules.json and remembers its version. */
export function resetToDefaults(mode: ImportMode): ImportResult {
  const file = loadDefaultRuleFile();
  const result = importRules(file, mode, "default");
  setSetting("defaults_version", String(file.version ?? 0));
  return result;
}

export function previewDefaults(): ImportPreview {
  return previewImport(loadDefaultRuleFile());
}

export function defaultsStatus(): {
  name: string;
  version: number;
  rules: number;
  groups: number;
  importedVersion: number;
} {
  const file = loadDefaultRuleFile();
  const groups = parseRuleFile(file);
  return {
    name: file.name ?? "default rules",
    version: file.version ?? 0,
    rules: groups.reduce((n, g) => n + g.rules.length, 0),
    groups: groups.length,
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
  const groups = listGroups();
  const orphans = rows.filter((r) => r.group_id === null || !groups.some((g) => g.id === r.group_id));
  const out: RuleGroupEntry[] = groups.map((g) => {
    const mine = rows.filter((r) => r.group_id === g.id);
    return {
      id: g.key,
      title: g.title,
      ...(g.description ? { description: g.description } : {}),
      ...(g.enabled ? {} : { enabled: false }),
      ...(mine.some((r) => r.effect === "deny") ? { deny: mine.filter((r) => r.effect === "deny").map(entry) } : {}),
      ...(mine.some((r) => r.effect === "allow") ? { allow: mine.filter((r) => r.effect === "allow").map(entry) } : {}),
    };
  });
  if (orphans.length) {
    out.push({
      id: BUILTIN_GROUPS.custom.key + (groups.some((g) => g.key === BUILTIN_GROUPS.custom.key) ? "-2" : ""),
      title: BUILTIN_GROUPS.custom.title,
      deny: orphans.filter((r) => r.effect === "deny").map(entry),
      allow: orphans.filter((r) => r.effect === "allow").map(entry),
    });
  }
  return {
    name: "apichap AI Coding Gateway rules",
    version: 1,
    exportedAt: new Date().toISOString(),
    groups: out,
  };
}

/** Rule file as JSON text with one rule per line, easy to read and diff. */
export function formatRuleFile(file: RuleFile & { exportedAt?: string }): string {
  const rule = (e: RuleEntry) =>
    JSON.stringify(e)
      .replace(/^\{"rule":/, '{ "rule": ')
      .replace(/,"note":/, ', "note": ')
      .replace(/,"enabled":/, ', "enabled": ')
      .replace(/\}$/, " }");
  const list = (xs: RuleEntry[], indent: string) =>
    xs.length ? `[\n${xs.map((e) => `${indent}  ${rule(e)}`).join(",\n")}\n${indent}]` : "[]";
  const fields = (obj: object, indent: string, skip: string[]) =>
    Object.entries(obj)
      .filter(([k, v]) => !skip.includes(k) && v !== undefined)
      .map(([k, v]) => `${indent}${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  const lists = (obj: { allow?: RuleEntry[]; deny?: RuleEntry[] }, indent: string) =>
    (["deny", "allow"] as const).filter((k) => obj[k]).map((k) => `${indent}"${k}": ${list(obj[k]!, indent)}`);
  const group = (g: RuleGroupEntry) =>
    `    {\n${[...fields(g, "      ", ["allow", "deny"]), ...lists(g, "      ")].join(",\n")}\n    }`;

  const lines = fields(file, "  ", ["groups", "allow", "deny"]);
  if (file.groups) lines.push(`  "groups": ${file.groups.length ? `[\n${file.groups.map(group).join(",\n")}\n  ]` : "[]"}`);
  lines.push(...lists(file, "  "));
  return `{\n${lines.join(",\n")}\n}\n`;
}
