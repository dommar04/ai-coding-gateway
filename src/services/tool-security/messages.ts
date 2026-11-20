import type { Verdict } from "./matching/engine";
import { managed } from "../company/session";

// Text returned to the agent session as the deny reason when a call is denied.

function nextSteps(): string {
  // Logged in: the company sets the rules, so the user can't add one locally.
  const allow = managed()
    ? "ask their company to change the rules (they are set centrally)"
    : "allow it from the Activity page of the viewtower dashboard, then ask you to retry";
  return [
    "Only the user can allow this. An agent permission prompt would not help.",
    "",
    "Decide how to proceed:",
    "- If you can still finish the task without this call (a different, allowed approach, or by skipping this optional step), continue and mention the denied call in your final summary.",
    "- If you really need it, stop and ask the user. Tell them viewtower denied this call and show them the exact command or action. " +
      `They can run it themselves and share the result with you (in Claude Code by typing \`! <command>\`), or ${allow}.`,
    "- Do not try to achieve the same effect another way (a different command, a script, or another tool). That would bypass the policy.",
  ].join("\n");
}

function describeCall(toolName: string, verdict: Verdict): string {
  return verdict.subject ? `${toolName}: \`${verdict.subject.value}\`` : `the ${toolName} tool`;
}

export function denyMessage(toolName: string, verdict: Verdict): string {
  if (verdict.decision !== "deny") return "";

  if (verdict.reason === "rule") {
    const note = verdict.rule.note ? ` (${verdict.rule.note})` : "";
    const policy = verdict.rule.group_title ? `Policy: ${verdict.rule.group_title}.` : "";
    return [
      `⛔ Denied by the viewtower: ${describeCall(toolName, verdict)}`,
      ...(policy ? [policy] : []),
      `It matches deny rule #${verdict.rule.id} \`${verdict.rule.rule}\`${note}.`,
      "",
      nextSteps(),
    ].join("\n");
  }

  const parts =
    verdict.subject?.kind === "command" && verdict.uncovered.length > 0
      ? `No allow rule covers: ${verdict.uncovered.map((p) => `\`${p}\``).join(", ")}.`
      : "No allow rule covers this tool call.";
  return [`⛔ Denied by the viewtower: ${describeCall(toolName, verdict)}`, parts, "", nextSteps()].join("\n");
}

export function gatewayErrorMessage(): string {
  return [
    "⛔ Denied by the viewtower: the gateway could not check this call (internal error), so it was blocked for safety.",
    "Do not try to achieve the same effect another way.",
  ].join("\n");
}
