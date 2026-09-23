import type { Verdict } from "./matching/engine";

// Text returned to the Claude session as permissionDecisionReason when a call is blocked.

const NEXT_STEPS = (requestLine: string) =>
  [
    "Only the gateway admins can grant this. The user cannot approve it locally, and a Claude Code permission prompt would not help either.",
    "",
    "Decide how to proceed:",
    "- If you can still finish the task without this call (a different, allowed approach, or by skipping this optional step), continue and mention the blocked call in your final summary.",
    `- If you cannot continue without it, stop and tell the user that this call needs admin approval${requestLine}. Once it is approved they can ask you to retry.`,
    "- Do not try to achieve the same effect another way (a different command, a script, or another tool). That would bypass the policy.",
  ].join("\n");

function describeCall(toolName: string, verdict: Verdict): string {
  return verdict.subject ? `${toolName}: \`${verdict.subject.value}\`` : `the ${toolName} tool`;
}

export function denyMessage(toolName: string, verdict: Verdict, requestId: number | null): string {
  if (verdict.decision !== "deny") return "";

  if (verdict.reason === "rule") {
    const note = verdict.rule.note ? ` (${verdict.rule.note})` : "";
    return [
      `⛔ Blocked by the apichap AI Coding Gateway: ${describeCall(toolName, verdict)}`,
      `It matches deny rule #${verdict.rule.id} \`${verdict.rule.rule}\`${note}.`,
      "",
      NEXT_STEPS(""),
    ].join("\n");
  }

  const parts =
    verdict.subject?.kind === "command" && verdict.uncovered.length > 0
      ? `Not on the approved list: ${verdict.uncovered.map((p) => `\`${p}\``).join(", ")}.`
      : "This tool call is not on the approved list.";
  const request = requestId !== null ? ` (approval request #${requestId})` : "";
  return [
    `⛔ Blocked by the apichap AI Coding Gateway: ${describeCall(toolName, verdict)}`,
    parts,
    requestId !== null ? `An approval request #${requestId} was filed for the admins automatically.` : "",
    "",
    NEXT_STEPS(request),
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");
}

export function gatewayErrorMessage(): string {
  return [
    "⛔ Blocked by the apichap AI Coding Gateway: the gateway could not check this call (internal error), so it was blocked for safety.",
    "Tell the user the apichap AI Coding Gateway is failing and that they should contact the gateway admins (details are in ~/.apichap-gateway/errors.log).",
    "Do not try to achieve the same effect another way.",
  ].join("\n");
}
