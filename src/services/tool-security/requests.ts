import { homedir } from "node:os";
import { parseJsonList } from "../../helpers/json";
import { currentUser } from "../../helpers/user";
import { transaction } from "../../storage/database";
import * as requestTable from "../../storage/tables/approval-requests";
import { upsertEnabledRule } from "../../storage/tables/tool-rules";
import { assertLocalPolicy } from "../settings";
import type { Verdict } from "./matching/engine";
import { parseRule } from "./matching/pattern";
import { suggestRules } from "./matching/suggest";
import { evaluateCall } from "./rules";

// Approval requests: unlisted tool calls waiting for an admin, and approving or rejecting them.

export type { RequestRow, RequestStatus } from "../../storage/tables/approval-requests";

export interface FileRequestArgs {
  toolName: string;
  toolInput: unknown;
  cwd: string;
  sessionId: string;
  verdict: Extract<Verdict, { reason: "unlisted" }>;
}

/** Files a pending approval request, or bumps the hit count of the same pending one. Returns its id. */
export function fileRequest(args: FileRequestArgs): number {
  const { verdict } = args;
  const suggestions = suggestRules(args.toolName, verdict.subject, verdict.uncovered, args.cwd, homedir());
  return requestTable.upsertPendingRequest({
    requestKey: [args.toolName, ...verdict.uncovered].join("\n"),
    toolName: args.toolName,
    subject: verdict.subject?.value ?? null,
    uncovered: verdict.uncovered,
    suggestedExact: suggestions.exact,
    suggestedBroad: suggestions.broad,
    toolInput: args.toolInput,
    sessionId: args.sessionId,
    project: args.cwd,
  });
}

export function listRequests(status: requestTable.RequestStatus | "all" = "pending") {
  return requestTable.listRequests(status);
}

export function getRequest(id: number) {
  return requestTable.getRequest(id);
}

export function countPendingRequests(): number {
  return requestTable.countPendingRequests();
}

export interface ApproveResult {
  ruleIds: number[];
  rules: string[];
  autoClosed: number[];
}

/**
 * Approves a request by adding allow rules (exact suggestion by default, broad or custom on request),
 * then closes every other pending request that the updated rules now cover.
 */
export function approveRequest(id: number, choice: { broad?: boolean; custom?: string[] }): ApproveResult {
  assertLocalPolicy("approve requests");
  const request = requireOpenRequest(id);
  const rules = choice.custom?.length
    ? choice.custom
    : parseJsonList(choice.broad ? request.suggested_broad : request.suggested_exact);
  if (rules.length === 0) throw new Error(`Approval request #${id} has no suggested rule; pass --rule.`);
  rules.forEach(parseRule);

  const user = currentUser();
  return transaction(() => {
    const ruleIds = rules.map((rule) =>
      upsertEnabledRule({ effect: "allow", rule, note: `approved from request #${id}`, source: "approved", createdBy: user })
    );
    requestTable.markRequestApproved(id, user, ruleIds);

    const autoClosed: number[] = [];
    for (const other of requestTable.listRequests("pending")) {
      let toolInput: unknown;
      try {
        toolInput = other.tool_input ? JSON.parse(other.tool_input) : null;
      } catch {
        continue;
      }
      if (evaluateCall(other.tool_name, toolInput, other.project ?? process.cwd()).decision === "allow") {
        requestTable.markRequestApproved(other.id, `${user} (covered by request #${id})`, ruleIds);
        autoClosed.push(other.id);
      }
    }
    return { ruleIds, rules, autoClosed };
  });
}

export function rejectRequest(id: number): void {
  assertLocalPolicy("reject requests");
  requireOpenRequest(id);
  requestTable.markRequestRejected(id, currentUser());
}

function requireOpenRequest(id: number) {
  const request = requestTable.getRequest(id);
  if (!request) throw new Error(`Approval request #${id} does not exist.`);
  if (request.status !== "pending") throw new Error(`Approval request #${id} is already ${request.status}.`);
  return request;
}
