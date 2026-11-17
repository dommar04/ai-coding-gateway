import { homedir } from "node:os";
import { currentUser } from "../../helpers/user";
import { disabledStacks } from "../settings";
import * as groupTable from "../../storage/tables/rule-groups";
import * as ruleTable from "../../storage/tables/tool-rules";
import { evaluate, type Rule, type Verdict } from "./matching/engine";
import { parseRule } from "./matching/pattern";
import { BUILTIN_GROUPS, groupKey } from "./rule-files/rule-file";

// Managing rules and rule groups, and evaluating a tool call against the enabled ones.

export type { RuleRow } from "../../storage/tables/tool-rules";
export type { GroupRow } from "../../storage/tables/rule-groups";

export function listRules(options: { enabledOnly?: boolean } = {}) {
  return ruleTable.listRules(options);
}

export function listGroups() {
  return groupTable.listGroups();
}

/** A group key not used yet, based on `base`. */
export function freeGroupKey(base: string): string {
  let key = base;
  for (let n = 2; groupTable.getGroupByKey(key); n++) key = `${base}-${n}`;
  return key;
}

/** The id of the group with this key, created from `init` when missing. */
export function ensureGroup(init: { key: string; title: string; description: string | null }, source: string): number {
  return groupTable.getGroupByKey(init.key)?.id ?? groupTable.insertGroup({ ...init, source, createdBy: currentUser() });
}

/** Where a rule goes when no group is chosen. */
export function customGroupId(): number {
  return ensureGroup(BUILTIN_GROUPS.custom, "gateway");
}

export function approvedGroupId(): number {
  return ensureGroup(BUILTIN_GROUPS.approved, "gateway");
}

export function addGroup(title: string, description: string | null, source: string): number {
  const t = title.trim();
  if (!t) throw new Error('A rule group needs a title, e.g. "The agent is not allowed to use Docker".');
  return groupTable.insertGroup({
    key: freeGroupKey(groupKey(t)),
    title: t,
    description: description?.trim() || null,
    source,
    createdBy: currentUser(),
  });
}

export function updateGroup(id: number, patch: { title?: string; description?: string | null; enabled?: boolean }): boolean {
  if (patch.title !== undefined && !patch.title.trim()) throw new Error("A rule group needs a title.");
  return groupTable.updateGroup(id, {
    ...patch,
    title: patch.title?.trim(),
    description: patch.description === undefined ? undefined : patch.description?.trim() || null,
  });
}

export function removeGroup(id: number): boolean {
  return groupTable.deleteGroup(id);
}

/** Resolves a group given by id or key; null means the custom group. */
export function resolveGroup(ref: number | string | null | undefined): number {
  if (ref === null || ref === undefined || ref === "") return customGroupId();
  const row = typeof ref === "number" ? groupTable.getGroup(ref) : groupTable.getGroupByKey(ref);
  if (!row) throw new Error(`Rule group ${typeof ref === "number" ? "#" + ref : `"${ref}"`} does not exist.`);
  return row.id;
}

export function addRule(
  effect: "allow" | "deny",
  rule: string,
  note: string | null,
  source: string,
  group?: number | string | null
): number {
  parseRule(rule); // validates, throws on malformed input
  const groupId = resolveGroup(group);
  const id = ruleTable.insertRule({ effect, rule: rule.trim(), note, source, createdBy: currentUser(), groupId });
  if (id === null) throw new Error(`The ${effect} rule ${rule.trim()} already exists.`);
  return id;
}

export function setRuleEnabled(id: number, enabled: boolean): boolean {
  return ruleTable.setRuleEnabled(id, enabled);
}

export function moveRule(id: number, group: number | string): boolean {
  return ruleTable.setRuleGroup(id, resolveGroup(group));
}

export function removeRule(id: number): boolean {
  return ruleTable.deleteRule(id);
}

// ---------- evaluation ----------

/** Where the rules used for decisions come from. Local database today; a signed remote bundle can plug in later. */
export interface RuleSource {
  loadRules(): Rule[];
}

/** Deny rules always count; an allow rule counts unless every stack it is for is switched off. */
export function stackActive(rule: Pick<ruleTable.RuleRow, "effect" | "tech_stacks">, off: Set<string>): boolean {
  if (rule.effect === "deny" || !rule.tech_stacks) return true;
  const stacks = JSON.parse(rule.tech_stacks) as string[];
  return !stacks.length || stacks.some((s) => s === "general" || !off.has(s));
}

/** Stacks named by any allow rule, without "general". Deny rules always apply, so their stacks switch nothing. */
export function listStacks(): string[] {
  const names = ruleTable
    .listRules()
    .filter((r) => r.effect === "allow")
    .flatMap((r) => (r.tech_stacks ? (JSON.parse(r.tech_stacks) as string[]) : []));
  return [...new Set(names)].filter((s) => s !== "general").sort();
}

export const localRuleSource: RuleSource = {
  loadRules: () => {
    const off = disabledStacks();
    return ruleTable.listRules({ enabledOnly: true }).filter((r) => stackActive(r, off));
  },
};
let activeRuleSource: RuleSource = localRuleSource;

export function setRuleSource(source: RuleSource): void {
  activeRuleSource = source;
}

export function evaluateCall(toolName: string, toolInput: unknown, cwd: string): Verdict {
  return evaluate({ toolName, toolInput, cwd, home: homedir() }, activeRuleSource.loadRules());
}
