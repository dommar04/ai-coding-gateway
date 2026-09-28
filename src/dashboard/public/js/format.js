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
export const decisionLabel = { allowed: "Allowed", denied: "Denied", would_deny: "Denied", observed: "Observed" };
export const decisionBadge = (d) =>
  `<span class="badge b-${decisionLabel[d] ? d : "other"}">${esc(decisionLabel[d] || d || "?")}</span>`;

// ---------- why a call was allowed or blocked ----------
export const isBlocked = (c) => c.decision === "denied" || c.decision === "would_deny";
const ALLOW_BUTTON = '<div><button class="btn sm primary" type="button" data-allow>Allow this call…</button></div>';

/** Plain-text reason, used as a tooltip. */
export function reasonTitle(c) {
  const r = c.reason;
  if (!r) return "";
  if (r.kind === "rule") {
    const what = r.deleted ? `rule #${r.ruleId} (deleted since)` : `${r.effect} rule #${r.ruleId}: ${r.rule}`;
    return (
      (r.group ? `${r.group}\n` : "") +
      (r.effect === "allow" ? "Allowed by " : "Denied by ") +
      what +
      (r.note ? ` (${r.note})` : "")
    );
  }
  return "No allow rule covers this call";
}

/** One small line under the decision badge, only for blocked calls. */
export function reasonShort(c) {
  const r = c.reason;
  if (!r || !isBlocked(c)) return "";
  if (r.kind === "rule") {
    return `<div class="reason mono">${r.deleted ? `rule #${r.ruleId} (deleted)` : esc(r.rule)}</div>`;
  }
  return '<div class="reason">no allow rule</div>';
}

/** Full explanation in the call details. */
export function reasonLong(c) {
  const r = c.reason;
  if (!r) return "";
  if (r.kind === "rule" && r.effect === "allow") {
    return `<div class="muted note-line">Allowed by rule #${r.ruleId} <code>${esc(r.rule)}</code>${r.group ? ` · ${esc(r.group)}` : ""}</div>`;
  }
  if (r.kind === "rule") {
    return `<div class="reason-box deny"><div><b>${c.decision === "would_deny" ? "Denied" : "Denied"}${r.group ? `: ${esc(r.group)}` : ` by deny rule #${r.ruleId}`}</b></div>
      ${r.deleted ? '<div class="muted">This rule has been deleted since.</div>' : `<div>Deny rule #${r.ruleId} <code>${esc(r.rule)}</code>${r.note ? ` · ${esc(r.note)}` : ""}</div>`}
      ${ALLOW_BUTTON}</div>`;
  }
  return `<div class="reason-box unlisted"><div><b>${c.decision === "would_deny" ? "Denied" : "Denied"}: no allow rule covers this call</b></div>
    ${ALLOW_BUTTON}</div>`;
}

/** Result tokens of a call, with the reduction ("12.3k → 4.1k −66%"). */
export function tokenCell(c) {
  const t = c.tokens || {};
  if (t.result == null) return '<span class="muted">—</span>';
  const saved = (t.result || 0) - (t.resultAfter ?? t.result);
  const title =
    `Claude wrote ${fmtTok(t.input)} tokens for this call · result ${fmtTok(t.result)} tokens` +
    (saved > 0 ? ` · Claude received ${fmtTok(t.resultAfter)}` : "");
  return (
    `<span class="tok" title="${esc(title)}">${fmtTok(t.result)}` +
    (saved > 0
      ? ` <span class="after">→ ${fmtTok(t.resultAfter)}</span> <span class="saved">−${pct(saved, t.result)}%</span>`
      : "") +
    "</span>"
  );
}

/** "mcp__claude-in-chrome__browser_batch" -> "claude-in-chrome · browser_batch". */
export const toolLabel = (name) => {
  const m = /^mcp__(.+)__([^_].*)$/.exec(name || "");
  return m ? `${m[1]} · ${m[2]}` : name || "?";
};

export function callRow(c) {
  const status =
    c.decision === "denied"
      ? "denied"
      : c.completedAt
        ? c.durationMs != null
          ? `${(c.durationMs / 1000).toFixed(1)}s`
          : "completed"
        : "running…";
  return `<tr data-id="${c.id}" class="${c._new ? "new" : ""}">
    <td class="time mono">${esc(fmtTime(c.startedAt || c.completedAt))}</td>
    <td class="tool" title="${esc(c.tool)}">${esc(toolLabel(c.tool))}${c.agentId ? ' <span class="pill" title="Called by a sub-agent">agent</span>' : ""}</td>
    <td class="summary" title="${esc(c.summary)}">${c.description ? `<div class="call-desc">${esc(c.description)}</div>` : ""}<div class="call-cmd mono">${esc(c.summary)}</div></td>
    <td>${tokenCell(c)}</td>
    <td title="${esc(reasonTitle(c))}">${decisionBadge(c.decision)}${reasonShort(c)}</td>
    <td class="status">${status}</td></tr>`;
}

export const strategyTitle = (id) => (state.strategies.find((s) => s.id === id) || {}).title || id;
