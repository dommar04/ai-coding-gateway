// Activity page: prompt groups, calls, filters, project filter, call details.
import { $, $$, MAX_CALLS, api, esc, guard, state, ui } from "./core.js";
import { baseName, callRow, decisionBadge, fmtTime, fmtTok, pct, reasonLong, strategyTitle } from "./format.js";

// ---------- activity: calls and prompt groups ----------
export function addToolOption(tool) {
  if (!tool || state.tools.has(tool)) return;
  state.tools.add(tool);
  const opt = document.createElement("option");
  opt.value = opt.textContent = tool;
  $("#f-tool").append(opt);
}

/** Recomputes a group's totals from its calls (after live updates). */
export function aggregate(g) {
  const calls = g.calls || [];
  g.callCount = Math.max(g.callCount || 0, calls.length);
  g.denied = calls.filter((c) => c.decision === "denied").length;
  g.wouldDeny = calls.filter((c) => c.decision === "would_deny").length;
  const sum = (f) => calls.reduce((n, c) => n + (f(c.tokens || {}) || 0), 0);
  g.tokens = {
    input: sum((t) => t.input),
    result: sum((t) => t.result),
    saved: sum((t) => (t.result != null ? t.result - (t.resultAfter ?? t.result) : 0)),
    potential: sum((t) => t.potential),
  };
  g.lastAt = calls.reduce(
    (m, c) => ((c.completedAt || c.startedAt || "") > m ? c.completedAt || c.startedAt : m),
    g.lastAt || ""
  );
}

export const refreshTimers = new Map();
/** Re-fetches a group's prompt text and API usage shortly after it changed (usage grows while Claude works). */
export function scheduleGroupRefresh(promptId) {
  clearTimeout(refreshTimers.get(promptId));
  refreshTimers.set(
    promptId,
    setTimeout(
      guard(async () => {
        const fresh = await api("GET", `/api/prompts/${encodeURIComponent(promptId)}`);
        const g = state.prompts.get(promptId);
        if (!g) return;
        Object.assign(g, { text: fresh.text, at: fresh.at, usage: fresh.usage, callCount: fresh.callCount });
        renderCalls();
      }),
      1500
    )
  );
}

export function upsertCalls(list, markNew) {
  for (const c of list) {
    if (!knownProject(c.project)) addProjectOption(c.project, 1);
    if (state.project && c.project !== state.project) continue;
    if (markNew && state.project) scheduleProjectTokens();
    const existing = state.calls.get(c.id);
    const merged = { ...existing, ...c, _new: markNew && !existing };
    state.calls.set(c.id, merged);
    addToolOption(c.tool);
    if (!c.promptId) continue;
    let g = state.prompts.get(c.promptId);
    if (!g && !markNew) continue; // older prompt outside the loaded groups: flat view only
    if (!g) {
      g = { promptId: c.promptId, text: null, at: c.startedAt, project: c.project, calls: [], usage: null, _new: markNew };
      state.prompts.set(c.promptId, g);
      if (markNew) state.expanded.add(c.promptId);
    }
    const i = g.calls.findIndex((x) => x.id === c.id);
    if (i >= 0) g.calls[i] = merged;
    else g.calls.push(merged);
    aggregate(g);
    if (markNew) scheduleGroupRefresh(c.promptId);
  }
  if (state.calls.size > MAX_CALLS) {
    const ids = [...state.calls.keys()].sort((a, b) => a - b);
    for (const id of ids.slice(0, state.calls.size - MAX_CALLS)) state.calls.delete(id);
  }
  renderCalls();
}

export function setPrompts(list) {
  for (const p of list) {
    p.calls = (p.calls || []).map((c) => {
      const existing = state.calls.get(c.id);
      const merged = { ...existing, ...c };
      state.calls.set(c.id, merged);
      addToolOption(c.tool);
      return merged;
    });
    state.prompts.set(p.promptId, p);
  }
  if (!state.expanded.size && list[0]) state.expanded.add(list[0].promptId);
}

export function matches(c) {
  const text = $("#f-text").value.toLowerCase();
  const tool = $("#f-tool").value;
  const decision = $("#f-decision").value;
  return (
    (!state.project || c.project === state.project) &&
    (!tool || c.tool === tool) &&
    (!decision || c.decision === decision) &&
    (!text || `${c.summary} ${c.project} ${c.tool}`.toLowerCase().includes(text))
  );
}

export function usageLine(u) {
  if (!u || !u.requests) return "";
  const input = u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
  return `API: ${fmtTok(input)} in (${pct(u.cacheReadTokens, input)}% cached) · ${fmtTok(u.outputTokens)} out · ${u.requests} requests`;
}

export function renderGrouped() {
  const filtering = $("#f-text").value || $("#f-tool").value || $("#f-decision").value || state.project;
  const groups = [...state.prompts.values()].sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  const html = groups
    .map((g) => {
      const calls = g.calls.filter(matches);
      if (filtering && !calls.length) return "";
      const open = state.expanded.has(g.promptId);
      const blocked = g.denied
        ? `<span class="pill bad">${g.denied} blocked</span>`
        : g.wouldDeny
          ? `<span class="pill warn">${g.wouldDeny} would block</span>`
          : "";
      const t = g.tokens || {};
      const text = g.text
        ? `<div class="pg-text" title="${esc(g.text)}">${esc(g.text)}</div>`
        : '<div class="pg-text none">Prompt text not available</div>';
      return `<div class="pg ${open ? "open" : ""} ${g._new ? "new" : ""}" data-pid="${esc(g.promptId)}">
      <button class="pg-head" aria-expanded="${open}">
        <svg class="icon chev"><use href="#i-chevron"/></svg>
        <div class="minw0">${text}
          <div class="pg-meta"><span>${esc(fmtTime(g.at))}</span><span>·</span><span>${esc(baseName(g.project))}</span><span>·</span>
            <span>${g.callCount} tool call${g.callCount === 1 ? "" : "s"}</span>${blocked}</div></div>
        <div class="pg-right">
          <div class="tok">Tools ${fmtTok(t.result)} tok${t.saved > 0 ? ` <span class="saved">−${fmtTok(t.saved)} (${pct(t.saved, t.result)}%)</span>` : ""}</div>
          <div class="usage">${esc(usageLine(g.usage))}</div>
        </div>
      </button>
      ${
        open
          ? `<div class="pg-body"><table><thead><tr><th>Time</th><th>Tool</th><th>Call</th><th>Tokens</th><th>Decision</th><th>Status</th></tr></thead>
        <tbody>${calls.map((c) => callRow(c, false)).join("")}</tbody></table></div>`
          : ""
      }
    </div>`;
    })
    .join("");
  const ungrouped = [...state.calls.values()].filter((c) => !c.promptId).length;
  $("#grouped-view").innerHTML =
    html +
    (ungrouped
      ? `<div class="empty compact">${ungrouped} older call(s) without a prompt link are only in <a href="#" data-view-link="flat">All calls</a>.</div>`
      : "");
  for (const g of state.prompts.values()) g._new = false;
}

export function renderCalls() {
  const all = [...state.calls.values()];
  const rows = all.sort((a, b) => b.id - a.id).filter(matches);
  $("#grouped-view").hidden = state.view !== "grouped";
  $("#flat-view").hidden = state.view !== "flat";
  $$("#view-toggle button").forEach((b) => b.classList.toggle("on", b.dataset.view === state.view));
  if (state.view === "grouped") renderGrouped();
  else $("#calls tbody").innerHTML = rows.map((c) => callRow(c, true)).join("");
  for (const c of state.calls.values()) c._new = false;
  $("#calls-empty").hidden = state.calls.size > 0;
  $("#k-blocked").textContent = all.filter((c) => c.decision === "denied" || c.decision === "would_deny").length;
  $("#calls-count").textContent =
    (state.view === "grouped" ? `${state.prompts.size} prompts · ` : "") +
    `Showing ${rows.length} of ${state.calls.size} calls` +
    (state.queued.length ? ` · ${state.queued.length} new while paused` : "");
}

// ---------- project filter ----------
export const knownProject = (p) => !p || state.projects.some((x) => x.project === p);
/** Folder name, or "parent/name" when two projects share a folder name. */
export function projectLabel(p) {
  const parts = String(p)
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/);
  const name = parts.pop();
  const clash = state.projects.filter((x) => baseName(x.project) === name).length > 1;
  return clash && parts.length ? `${parts.pop()}/${name}` : name;
}
export function renderProjectOptions() {
  const sel = $("#f-project");
  sel.innerHTML =
    '<option value="">All projects</option>' +
    state.projects
      .map(
        (x) => `<option value="${esc(x.project)}" title="${esc(x.project)}">${esc(projectLabel(x.project))} (${x.calls})</option>`
      )
      .join("");
  if (state.project && !knownProject(state.project)) state.project = "";
  sel.value = state.project;
}
export function addProjectOption(project, calls) {
  if (!project) return;
  state.projects.unshift({ project, calls, lastAt: new Date().toISOString() });
  renderProjectOptions();
}
export let projectTokensTimer;
export function scheduleProjectTokens() {
  clearTimeout(projectTokensTimer);
  projectTokensTimer = setTimeout(guard(loadProjectTokens), 1500);
}
export async function loadProjectTokens() {
  state.projectTokens = state.project ? await api("GET", `/api/tokens?project=${encodeURIComponent(state.project)}`) : null;
  ui.renderStats();
}
/** (Re)loads groups and calls, for the selected project only when one is set. */
export async function loadActivity() {
  const q = state.project ? `&project=${encodeURIComponent(state.project)}` : "";
  state.calls.clear();
  state.prompts.clear();
  state.expanded.clear();
  setPrompts(await api("GET", `/api/prompts?limit=40${q}`));
  upsertCalls(await api("GET", `/api/calls?limit=300${q}`), false);
  await loadProjectTokens();
}
$("#f-project").addEventListener(
  "change",
  guard(async (e) => {
    state.project = e.target.value;
    try {
      localStorage.setItem("apichap-gateway-project", state.project);
    } catch {}
    await loadActivity();
  })
);

["#f-text", "#f-tool", "#f-decision"].forEach((s) => $(s).addEventListener("input", renderCalls));
export function setView(view) {
  state.view = view;
  try {
    localStorage.setItem("apichap-gateway-view", view);
  } catch {}
  renderCalls();
}
$$("#view-toggle button").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
$("#grouped-view").addEventListener("click", (e) => {
  const link = e.target.closest("[data-view-link]");
  if (link) {
    e.preventDefault();
    setView(link.dataset.viewLink);
    return;
  }
  const head = e.target.closest(".pg-head");
  if (!head) return;
  const pid = head.closest(".pg").dataset.pid;
  if (state.expanded.has(pid)) state.expanded.delete(pid);
  else state.expanded.add(pid);
  renderCalls();
});
$("#pause").addEventListener("click", () => {
  state.paused = !state.paused;
  $("#pause").innerHTML = state.paused
    ? '<svg class="icon"><use href="#i-play"/></svg><span>Resume</span>'
    : '<svg class="icon"><use href="#i-pause"/></svg><span>Pause</span>';
  if (!state.paused && state.queued.length) {
    const q = state.queued;
    state.queued = [];
    upsertCalls(q, true);
  } else renderCalls();
});

// ---------- call details ----------

export async function openCall(id) {
  const c = await api("GET", `/api/calls/${id}`);
  if (!state.strategies.length) state.strategies = (await api("GET", "/api/reduction")).strategies;
  $("#detail-title").textContent = `${c.tool} · call #${c.id}`;
  const json = (v) => esc(typeof v === "string" ? v : JSON.stringify(v, null, 2));
  const t = c.tokens || {};
  const saved = t.result != null ? t.result - (t.resultAfter ?? t.result) : 0;
  const breakdown = (Array.isArray(c.reduction) ? c.reduction : [])
    .map(
      (b) =>
        `<span>${esc(strategyTitle(b.id))}${b.state === "measure" ? ' <span class="measured">(measure only)</span>' : ""}</span><span class="${b.state === "on" ? "saved" : "measured"}">−${fmtTok(b.saved)}</span>`
    )
    .join("");
  const rewrite = c.inputRewrite && c.inputRewrite.applied ? c.inputRewrite : null;
  $("#detail-body").innerHTML = `
    <dl>
      <dt>Decision</dt><dd>${decisionBadge(c.decision)}${reasonLong(c)}</dd>
      <dt>Started</dt><dd>${esc(fmtTime(c.startedAt))}${c.durationMs != null ? ` · took ${(c.durationMs / 1000).toFixed(2)}s` : ""}</dd>
      <dt>Project</dt><dd class="mono">${esc(c.project)}</dd>
      <dt>Session</dt><dd class="mono">${esc(c.sessionId)}${c.agentId ? ` · agent ${esc(c.agentId)}` : ""}</dd>
      <dt>Tool use id</dt><dd class="mono">${esc(c.toolUseId)}</dd>
    </dl>
    <h3>Tokens (estimated)</h3>
    <dl class="flush">
      <dt>Claude wrote</dt><dd>${fmtTok(t.input)} tokens for the call</dd>
      <dt>Result</dt><dd>${t.result == null ? "—" : `${fmtTok(t.result)} tokens`}${saved > 0 ? ` → Claude received <b>${fmtTok(t.resultAfter)}</b> <span class="saved">(−${fmtTok(saved)}, ${pct(saved, t.result)}%)</span>` : ""}</dd>
      ${t.potential ? `<dt>Possible</dt><dd class="measured">Measure options would save ${fmtTok(t.potential)} more</dd>` : ""}
    </dl>
    ${breakdown ? `<div class="breakdown">${breakdown}</div>` : ""}
    ${rewrite ? `<h3>Changed before it ran</h3><div class="muted text13">${rewrite.applied.map((id) => esc(strategyTitle(id))).join(", ")}</div><pre>${json(rewrite.notes.join("\n"))}</pre>` : ""}
    <h3>Input</h3><pre>${json(c.input)}</pre>
    ${
      c.reducedResult != null
        ? `<div class="tabs"><button class="on" data-tab="sent">Sent to Claude</button><button data-tab="orig">Original result</button></div>
      <pre data-pane="sent">${json(c.reducedResult)}</pre><pre data-pane="orig" hidden>${json(c.result)}</pre>`
        : `<h3>Result</h3><pre>${c.result == null ? '<span class="muted">—</span>' : json(c.result)}</pre>`
    }`;
  $("#detail").classList.add("open");
  $("#detail").setAttribute("aria-hidden", "false");
}

$("#page-calls").addEventListener("click", (e) => {
  if (e.target.closest("a")) return; // e.g. the approval request link in a row
  const tr = e.target.closest("tr[data-id]");
  if (tr) guard(openCall)(tr.dataset.id);
});
$("#detail-body").addEventListener("click", (e) => {
  const tab = e.target.closest(".tabs button");
  if (tab) {
    $$("#detail-body .tabs button").forEach((b) => b.classList.toggle("on", b === tab));
    $$("#detail-body [data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== tab.dataset.tab));
    return;
  }
  if (e.target.closest("a")) closeDetail();
});
export const closeDetail = () => {
  $("#detail").classList.remove("open");
  $("#detail").setAttribute("aria-hidden", "true");
};
$("#detail-close").addEventListener("click", closeDetail);
document.addEventListener("keydown", (e) => e.key === "Escape" && closeDetail());
