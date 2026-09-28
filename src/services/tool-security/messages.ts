import type { Verdict } from "./matching/engine";

// Text returned to the Claude session as permissionDecisionReason when a call is denied.

const NEXT_STEPS = [
  "Only the user can allow this, in the gateway dashboard: they open the denied call on the Activity page and add a rule. A Claude Code permission prompt would not help.",
  "",
  "Decide how to proceed:",
  "- If you can still finish the task without this call (a different, allowed approach, or by skipping this optional step), continue and mention the denied call in your final summary.",
  "- If you cannot continue without it, stop and tell the user that this call is denied by the gateway and can be allowed from its Activity page. Once it is allowed they can ask you to retry.",
  "- Do not try to achieve the same effect another way (a different command, a script, or another tool). That would bypass the policy.",
].join("\n");

function describeCall(toolName: string, verdict: Verdict): string {
  return verdict.subject ? `${toolName}: \`${verdict.subject.value}\`` : `the ${toolName} tool`;
}

export function denyMessage(toolName: string, verdict: Verdict): string {
  if (verdict.decision !== "deny") return "";

  if (verdict.reason === "rule") {
    const note = verdict.rule.note ? ` (${verdict.rule.note})` : "";
    const policy = verdict.rule.group_title ? `Policy: ${verdict.rule.group_title}.` : "";
    return [
      `⛔ Denied by the apichap AI Coding Gateway: ${describeCall(toolName, verdict)}`,
      ...(policy ? [policy] : []),
      `It matches deny rule #${verdict.rule.id} \`${verdict.rule.rule}\`${note}.`,
      "",
      NEXT_STEPS,
    ].join("\n");
  }

  const parts =
    verdict.subject?.kind === "command" && verdict.uncovered.length > 0
      ? `No allow rule covers: ${verdict.uncovered.map((p) => `\`${p}\``).join(", ")}.`
      : "No allow rule covers this tool call.";
  return [`⛔ Denied by the apichap AI Coding Gateway: ${describeCall(toolName, verdict)}`, parts, "", NEXT_STEPS].join("\n");
}

export function gatewayErrorMessage(): string {
  return [
    "⛔ Denied by the apichap AI Coding Gateway: the gateway could not check this call (internal error), so it was blocked for safety.",
    "Tell the user the apichap AI Coding Gateway is failing (details are in ~/.ai-coding-gateway/errors.log).",
    "Do not try to achieve the same effect another way.",
  ].join("\n");
}
