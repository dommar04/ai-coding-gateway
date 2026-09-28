import { homedir } from "node:os";
import { currentUser } from "../../helpers/user";
import { transaction } from "../../storage/database";
import { upsertEnabledRule } from "../../storage/tables/tool-rules";
import { parseRule } from "./matching/pattern";
import { suggestRules } from "./matching/suggest";
import { approvedGroupId, evaluateCall, resolveGroup } from "./rules";

// Allowing a denied call from the activity: what the current rules say about it, ready-made
// allow rules (exact and broad), and adding the chosen ones.

export interface CallRef {
  toolName: string;
  toolInput: unknown;
  cwd: string;
}

export type AllowOptions =
  | { state: "allowed" }
  | { state: "denied-by-rule"; rule: { id: number; rule: string; note: string | null; group: string | null } }
  | { state: "unlisted"; uncovered: string[]; exact: string[]; broad: string[] };

/** Evaluates the call against the current rules (they may have changed since it ran). */
export function allowOptions(call: CallRef): AllowOptions {
  const verdict = evaluateCall(call.toolName, call.toolInput, call.cwd);
  if (verdict.decision === "allow") return { state: "allowed" };
  if (verdict.reason === "rule") {
    const r = verdict.rule;
    return { state: "denied-by-rule", rule: { id: r.id, rule: r.rule, note: r.note, group: r.group_title ?? null } };
  }
  const suggestions = suggestRules(call.toolName, verdict.subject, verdict.uncovered, call.cwd, homedir());
  return { state: "unlisted", uncovered: verdict.uncovered, ...suggestions };
}

export interface AllowResult {
  ruleIds: number[];
  rules: string[];
}

/**
 * Adds allow rules for a call no rule covers: the exact suggestion by default, broad or custom on
 * request. They go into the given group, or the group for calls allowed from the activity.
 */
export function allowCall(
  call: CallRef,
  choice: { broad?: boolean; custom?: string[]; group?: number | string | null }
): AllowResult {
  const options = allowOptions(call);
  if (options.state === "allowed") throw new Error("The current rules already allow this call.");
  if (options.state === "denied-by-rule")
    throw new Error(
      `Deny rule #${options.rule.id} ${options.rule.rule} blocks this call; deny rules always win over allow rules.`
    );

  const rules = choice.custom?.length ? choice.custom : choice.broad ? options.broad : options.exact;
  if (rules.length === 0) throw new Error("There is no suggested rule for this call; enter one yourself.");
  rules.forEach(parseRule);

  const user = currentUser();
  return transaction(() => {
    const groupId =
      choice.group === undefined || choice.group === null || choice.group === "" ? approvedGroupId() : resolveGroup(choice.group);
    const ruleIds = rules.map((rule) =>
      upsertEnabledRule({ effect: "allow", rule, note: null, source: "activity", createdBy: user, groupId })
    );
    return { ruleIds, rules };
  });
}
