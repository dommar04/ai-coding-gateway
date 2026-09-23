import { homedir } from "node:os";
import { currentUser } from "../../helpers/user";
import * as ruleTable from "../../storage/tables/tool-rules";
import { assertLocalPolicy } from "../settings";
import { evaluate, type Rule, type Verdict } from "./matching/engine";
import { parseRule } from "./matching/pattern";

// Managing rules, and evaluating a tool call against the enabled ones.

export type { RuleRow } from "../../storage/tables/tool-rules";

export function listRules(options: { enabledOnly?: boolean } = {}) {
  return ruleTable.listRules(options);
}

export function addRule(effect: "allow" | "deny", rule: string, note: string | null, source: string): number {
  assertLocalPolicy("add rules");
  parseRule(rule); // validates, throws on malformed input
  const id = ruleTable.insertRule({ effect, rule: rule.trim(), note, source, createdBy: currentUser() });
  if (id === null) throw new Error(`The ${effect} rule ${rule.trim()} already exists.`);
  return id;
}

export function setRuleEnabled(id: number, enabled: boolean): boolean {
  assertLocalPolicy("change rules");
  return ruleTable.setRuleEnabled(id, enabled);
}

export function removeRule(id: number): boolean {
  assertLocalPolicy("remove rules");
  return ruleTable.deleteRule(id);
}

// ---------- evaluation ----------

/** Where the rules used for decisions come from. Local database today; a signed remote bundle can plug in later. */
export interface RuleSource {
  loadRules(): Rule[];
}

export const localRuleSource: RuleSource = { loadRules: () => ruleTable.listRules({ enabledOnly: true }) };
let activeRuleSource: RuleSource = localRuleSource;

export function setRuleSource(source: RuleSource): void {
  activeRuleSource = source;
}

export function evaluateCall(toolName: string, toolInput: unknown, cwd: string): Verdict {
  return evaluate({ toolName, toolInput, cwd, home: homedir() }, activeRuleSource.loadRules());
}
