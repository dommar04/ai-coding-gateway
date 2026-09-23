// Formatting helpers and the pieces of a call row (tokens, decision, reason).
import { $, esc, state } from "./core.js";

// ---------- formatting ----------
export const fmtTok = (n) => {
  n = Number(n) || 0;
  if (n < 1000) return String(n);
  if (n < 1e6) return (n / 1000).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, "") + "k";
  return (n / 1e6).toFixed(n < 1e7 ? 2 : 1).replace(/\.?0+$/, "") + "M";
};
export const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
export const fmtTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return (today ? "" : d.toLocaleDateString() + " ") + d.toLocaleTimeString();
};
export const baseName = (p) =>
  p
    ? String(p)
        .replace(/[\\/]+$/, "")
        .split(/[\\/]/)
        .pop()
    : "";
export const decisionLabel = { allowed: "Allowed", denied: "Denied", would_deny: "Would deny", observed: "Observed" };
export const decisionBadge = (d) =>
  `<span class="badge b-${decisionLabel[d] ? d : "other"}">${esc(decisionLabel[d] || d || "?")}</span>`;

// ---------- why a call was allowed or blocked ----------
export const isBlocked = (c) => c.decision === "denied" || c.decision === "would_deny";
export const requestStatus = (s) =>
  s === "pending" ? "pending" : s === "approved" ? "approved since" : s === "rejected" ? "rejected" : "";

/** Plain-text reason, used as a tooltip. */
export function reasonTitle(c) {
  const r = c.reason;
  if (!r) return "";
  if (r.kind === "rule") {
    const what = r.deleted ? `rule #${r.ruleId} (deleted since)` : `${r.effect} rule #${r.ruleId}: ${r.rule}`;
    return (r.effect === "allow" ? "Allowed by " : "Blocked by ") + what + (r.note ? ` (${r.note})` : "");
  }
  return `Not on the allowlist · approval request #${r.requestId}${r.requestStatus ? ` (${requestStatus(r.requestStatus)})` : ""}`;
}

/** One small line under the decision badge, only for blocked calls. */
export function reasonShort(c) {
  const r = c.reason;
  if (!r || !isBlocked(c)) return "";
  if (r.kind === "rule") {
    return `<div class="reason mono">${r.deleted ? `rule #${r.ruleId} (deleted)` : esc(r.rule)}</div>`;
  }
  return `<div class="reason">not on allowlist · <a href="#approvals">#${r.requestId}</a>${r.requestStatus && r.requestStatus !== "pending" ? ` ${esc(requestStatus(r.requestStatus))}` : ""}</div>`;
}

/** Full explanation in the call details. */
export function reasonLong(c) {
  const r = c.reason;
  if (!r) return "";
  if (r.kind === "rule" && r.effect === "allow") {
    return `<div class="muted note-line">Allowed by rule #${r.ruleId} <code>${esc(r.rule)}</code></div>`;
  }
  if (r.kind === "rule") {
    return `<div class="reason-box deny"><div><b>${c.decision === "would_deny" ? "Would be blocked" : "Blocked"} by deny rule #${r.ruleId}</b></div>
      ${r.deleted ? '<div class="muted">This rule has been deleted since.</div>' : `<div><code>${esc(r.rule)}</code></div>${r.note ? `<div>${esc(r.note)}</div>` : ""}`}
      <div><a href="#rules">Manage rules</a></div></div>`;
  }
  const status =
    r.requestStatus === "approved"
      ? "It has been approved since, so the same call is allowed now."
      : r.requestStatus === "rejected"
        ? "The request was rejected."
        : "The request is waiting for an admin.";
  return `<div class="reason-box unlisted"><div><b>${c.decision === "would_deny" ? "Would be blocked" : "Blocked"}: not on the allowlist</b></div>
    <div>No allow rule covers this call, so approval request #${r.requestId} was filed. ${status}</div>
    <div><a href="#approvals">Open approvals</a></div></div>`;
}

/** Result tokens of a call, with the reduction ("12.3k → 4.1k −66%"). */
export function tokenCell(c) {
  const t = c.tokens || {};
  if (t.result == null) return '<span class="muted">—</span>';
  const saved = (t.result || 0) - (t.resultAfter ?? t.result);
  const title =
    `Claude wrote ${fmtTok(t.input)} tokens for this call · result ${fmtTok(t.result)} tokens` +
    (saved > 0 ? ` · Claude received ${fmtTok(t.resultAfter)}` : "") +
    (t.potential ? ` · Measure options would save ${fmtTok(t.potential)} more` : "");
  return (
    `<span class="tok" title="${esc(title)}">${fmtTok(t.result)}` +
    (saved > 0
      ? ` <span class="after">→ ${fmtTok(t.resultAfter)}</span> <span class="saved">−${pct(saved, t.result)}%</span>`
      : "") +
    (t.potential > 0 ? ` <span class="measured">(−${fmtTok(t.potential)}?)</span>` : "") +
    "</span>"
  );
}

/** "mcp__claude-in-chrome__browser_batch" -> "claude-in-chrome · browser_batch". */
export const toolLabel = (name) => {
  const m = /^mcp__(.+)__([^_].*)$/.exec(name || "");
  return m ? `${m[1]} · ${m[2]}` : name || "?";
};

export function callRow(c, withProject) {
  const status =
    c.decision === "denied"
      ? "blocked"
      : c.completedAt
        ? c.durationMs != null
          ? `${(c.durationMs / 1000).toFixed(1)}s`
          : "completed"
        : "running…";
  return `<tr data-id="${c.id}" class="${c._new ? "new" : ""}">
    <td class="time mono">${esc(fmtTime(c.startedAt || c.completedAt))}</td>
    <td class="tool" title="${esc(c.tool)}">${esc(toolLabel(c.tool))}${c.agentId ? ' <span class="pill" title="Called by a sub-agent">agent</span>' : ""}</td>
    <td class="summary mono" title="${esc(c.summary)}">${esc(c.summary)}</td>
    ${withProject ? `<td class="muted" title="${esc(c.project)}">${esc(baseName(c.project))}</td>` : ""}
    <td>${tokenCell(c)}</td>
    <td title="${esc(reasonTitle(c))}">${decisionBadge(c.decision)}${reasonShort(c)}</td>
    <td class="status">${status}</td></tr>`;
}

export const strategyTitle = (id) => (state.strategies.find((s) => s.id === id) || {}).title || id;
