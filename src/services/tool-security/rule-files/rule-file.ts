import { readFileSync } from "node:fs";
import { packageFile } from "../../../helpers/paths";
import { parseRule } from "../matching/pattern";

// Rule files: a JSON document with rule groups. Each group is one policy in plain words with the
// allow and deny rules that implement it. The default rules (rules/default-rules.json) fill new
// databases; the same format is used for import and export.
//
// {
//   "$schema": "./rule-file.schema.json",
//   "name": "My team rules", "version": 1, "description": "...",
//   "groups": [
//     { "id": "no-deleting-files", "title": "The agent is not allowed to delete files",
//       "description": "why", "deny": [ { "rule": "Shell(rm *)" } ] },
//     { "id": "git", "title": "The agent is allowed to use git", "allow": [ { "rule": "Shell(git *)" } ] }
//   ]
// }
//
// Every rule entry is { rule, note?, enabled? } (rules/rule-file.schema.json). For hand-written
// files, import also accepts a plain rule string as shorthand; export always writes objects.
// Files in the older format (top-level "allow" and "deny" lists, no groups) are imported as one group.

export type RuleObject = { rule: string; note?: string | null; enabled?: boolean };
export type RuleEntry = RuleObject | string;

export interface RuleGroupEntry {
  id: string;
  title: string;
  description?: string;
  enabled?: boolean;
  allow?: RuleEntry[];
  deny?: RuleEntry[];
}

export interface RuleFile {
  $schema?: string;
  name?: string;
  version?: number;
  description?: string;
  groups?: RuleGroupEntry[];
  /** Older format without groups. */
  allow?: RuleEntry[];
  deny?: RuleEntry[];
}

export interface NormalizedRule {
  effect: "allow" | "deny";
  rule: string;
  note: string | null;
  enabled: boolean;
  /** Key of the group the rule belongs to. */
  group: string;
}

export interface NormalizedGroup {
  key: string;
  title: string;
  description: string | null;
  enabled: boolean;
  rules: NormalizedRule[];
}

/** Key and title of the group that older, group-less files are imported into. */
export const LEGACY_GROUP = { key: "imported", title: "Imported rules" };

/** Groups the gateway creates when a rule needs a home. */
export const BUILTIN_GROUPS = {
  approved: {
    key: "approved",
    title: "The agent is allowed to make calls you allowed from the activity",
    description: "Rules added from a denied call on the Activity page.",
  },
  custom: {
    key: "custom",
    title: "Custom rules",
    description: "Rules added without choosing a group. Move them into a group that says what they are for.",
  },
  previousDefaults: {
    key: "previous-defaults",
    title: "Rules from an earlier version of the default rules",
    description:
      "The current default rules no longer contain these. Delete this group to follow the current defaults, or keep the rules you still want.",
  },
} as const;

export function defaultRulesPath(): string {
  return packageFile("rules", "default-rules.json");
}

export function readRuleFile(path: string): RuleFile {
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  try {
    return JSON.parse(text) as RuleFile;
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function loadDefaultRuleFile(): RuleFile {
  return readRuleFile(defaultRulesPath());
}

/** "The agent may use Docker!" -> "the-agent-may-use-docker" */
export function groupKey(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "") || "group"
  );
}

/** Checks a rule file and returns its groups with their rules. Throws one error listing every problem found. */
export function parseRuleFile(file: unknown): NormalizedGroup[] {
  if (!file || typeof file !== "object" || Array.isArray(file))
    throw new Error('A rule file must be a JSON object with a "groups" list.');
  const f = file as Record<string, unknown>;
  const problems: string[] = [];
  const groups: NormalizedGroup[] = [];
  // A rule (effect + text) exists once; a repeat in a later group is dropped.
  const seenRules = new Set<string>();
  const seenGroups = new Set<string>();

  const readRules = (group: NormalizedGroup, source: Record<string, unknown>, where: string) => {
    for (const effect of ["allow", "deny"] as const) {
      const list = source[effect];
      if (list === undefined) continue;
      if (!Array.isArray(list)) {
        problems.push(`${where}"${effect}" must be a list.`);
        continue;
      }
      list.forEach((entry: unknown, i) => {
        const at = `${where}${effect}[${i}]`;
        const obj = typeof entry === "string" ? { rule: entry } : entry;
        if (!obj || typeof obj !== "object" || typeof (obj as { rule?: unknown }).rule !== "string") {
          problems.push(`${at}: expected "Tool(pattern)" or { "rule": "Tool(pattern)", "note": "..." }.`);
          return;
        }
        const { rule, note, enabled } = obj as { rule: string; note?: unknown; enabled?: unknown };
        try {
          parseRule(rule);
        } catch (err) {
          problems.push(`${at}: ${err instanceof Error ? err.message : String(err)}`);
          return;
        }
        if (note !== undefined && note !== null && typeof note !== "string") problems.push(`${at}: "note" must be text.`);
        if (enabled !== undefined && typeof enabled !== "boolean") problems.push(`${at}: "enabled" must be true or false.`);
        const key = `${effect}\n${rule.trim()}`;
        if (seenRules.has(key)) return; // duplicates are harmless; keep the first
        seenRules.add(key);
        group.rules.push({
          effect,
          rule: rule.trim(),
          note: typeof note === "string" && note.trim() ? note.trim() : null,
          enabled: enabled !== false,
          group: group.key,
        });
      });
    }
  };

  if (f.groups !== undefined) {
    if (!Array.isArray(f.groups)) {
      problems.push('"groups" must be a list.');
    } else {
      f.groups.forEach((entry: unknown, i) => {
        const where = `groups[${i}]`;
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          problems.push(`${where}: expected { "id", "title", "allow", "deny" }.`);
          return;
        }
        const g = entry as Record<string, unknown>;
        const title = typeof g.title === "string" ? g.title.trim() : "";
        if (!title) problems.push(`${where}: "title" is missing. Describe the policy in one sentence.`);
        if (g.id !== undefined && (typeof g.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(g.id)))
          problems.push(`${where}: "id" must be lowercase letters, digits and dashes, e.g. "no-deleting-files".`);
        if (g.description !== undefined && typeof g.description !== "string")
          problems.push(`${where}: "description" must be text.`);
        if (g.enabled !== undefined && typeof g.enabled !== "boolean")
          problems.push(`${where}: "enabled" must be true or false.`);
        const key = typeof g.id === "string" && g.id ? g.id : groupKey(title);
        if (seenGroups.has(key)) problems.push(`${where}: the id "${key}" is used by another group.`);
        seenGroups.add(key);
        const group: NormalizedGroup = {
          key,
          title: title || key,
          description: typeof g.description === "string" && g.description.trim() ? g.description.trim() : null,
          enabled: g.enabled !== false,
          rules: [],
        };
        readRules(group, g, `${where}.`);
        groups.push(group);
      });
    }
  }

  // Older format: top-level lists become one group.
  if (f.allow !== undefined || f.deny !== undefined) {
    const title = typeof f.name === "string" && f.name.trim() ? f.name.trim() : LEGACY_GROUP.title;
    const key = seenGroups.has(LEGACY_GROUP.key) ? groupKey(title) : LEGACY_GROUP.key;
    const group: NormalizedGroup = { key, title, description: null, enabled: true, rules: [] };
    readRules(group, f, "");
    groups.push(group);
  }

  if (!("groups" in f) && !("allow" in f) && !("deny" in f)) problems.push('The file has no "groups" list.');
  if (problems.length) throw new Error(`The rule file has ${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  return groups;
}

/** All rules of a rule file, flat, each with the key of its group. */
export function normalizeRuleFile(file: unknown): NormalizedRule[] {
  return parseRuleFile(file).flatMap((g) => g.rules);
}
