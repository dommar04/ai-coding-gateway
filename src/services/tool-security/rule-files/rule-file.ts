import { readFileSync } from "node:fs";
import { packageFile } from "../../../helpers/paths";
import { parseRule } from "../matching/pattern";

// Rule files: a JSON document with an allow list and a deny list. The default rules
// (rules/default-rules.json) fill new databases; the same format is used for import and export.
//
// {
//   "$schema": "./rule-file.schema.json",
//   "name": "My team rules", "version": 1, "description": "...",
//   "allow": [ { "rule": "Read" }, { "rule": "Shell(git *)", "note": "why" } ],
//   "deny":  [ { "rule": "Shell(rm *)", "note": "shown to Claude when this blocks" } ]
// }
//
// Every entry is { rule, note?, enabled? } (rules/rule-file.schema.json). For hand-written
// files, import also accepts a plain rule string as shorthand; export always writes objects.

export type RuleObject = { rule: string; note?: string | null; enabled?: boolean };
export type RuleEntry = RuleObject | string;

export interface RuleFile {
  $schema?: string;
  name?: string;
  version?: number;
  description?: string;
  allow?: RuleEntry[];
  deny?: RuleEntry[];
}

export interface NormalizedRule {
  effect: "allow" | "deny";
  rule: string;
  note: string | null;
  enabled: boolean;
}

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

/** Checks a rule file and returns its rules. Throws one error listing every problem found. */
export function normalizeRuleFile(file: unknown): NormalizedRule[] {
  if (!file || typeof file !== "object" || Array.isArray(file))
    throw new Error('A rule file must be a JSON object with "allow" and "deny" lists.');
  const f = file as Record<string, unknown>;
  const problems: string[] = [];
  const rules: NormalizedRule[] = [];
  const seen = new Set<string>();

  for (const effect of ["allow", "deny"] as const) {
    const list = f[effect];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      problems.push(`"${effect}" must be a list.`);
      continue;
    }
    list.forEach((entry: unknown, i) => {
      const where = `${effect}[${i}]`;
      const obj = typeof entry === "string" ? { rule: entry } : entry;
      if (!obj || typeof obj !== "object" || typeof (obj as { rule?: unknown }).rule !== "string") {
        problems.push(`${where}: expected "Tool(pattern)" or { "rule": "Tool(pattern)", "note": "..." }.`);
        return;
      }
      const { rule, note, enabled } = obj as { rule: string; note?: unknown; enabled?: unknown };
      try {
        parseRule(rule);
      } catch (err) {
        problems.push(`${where}: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      if (note !== undefined && note !== null && typeof note !== "string") problems.push(`${where}: "note" must be text.`);
      if (enabled !== undefined && typeof enabled !== "boolean") problems.push(`${where}: "enabled" must be true or false.`);
      const key = `${effect}\n${rule.trim()}`;
      if (seen.has(key)) return; // duplicates are harmless; keep the first
      seen.add(key);
      rules.push({
        effect,
        rule: rule.trim(),
        note: typeof note === "string" && note.trim() ? note.trim() : null,
        enabled: enabled !== false,
      });
    });
  }

  if (!("allow" in f) && !("deny" in f)) problems.push('The file has neither an "allow" nor a "deny" list.');
  if (problems.length) throw new Error(`The rule file has ${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  return rules;
}
