// Activity page: prompt groups, calls, filters, project filter, call details.
import { $, $$, MAX_CALLS, api, esc, guard, state, toast } from "./core.js";
import { baseName, callRow, decisionBadge, fmtTime, fmtTok, isBlocked, pct, reasonLong, strategyTitle } from "./format.js";
import { openAllowDialog } from "./allow.js";
import { renderMarkdown } from "./markdown.js";

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
    const existing = state.calls.get(c.id);
    const merged = { ...existing, ...c, _new: markNew && !existing };
    state.calls.set(c.id, merged);
    addToolOption(c.tool);
    if (!c.promptId) continue;
    let g = state.prompts.get(c.promptId);
    if (!g && !markNew) continue; // older prompt outside the loaded groups
    if (!g) {
      g = {
        promptId: c.promptId,
        integration: c.integration,
        text: null,
        at: c.startedAt,
        project: c.project,
        calls: [],
        usage: null,
        _new: markNew,
      };
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
    if (!knownProject(p.project)) addProjectOption(p.project, 0);
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
    (!decision || (decision === "denied" ? isBlocked(c) : c.decision === decision)) &&
    (!text || `${c.description ?? ""} ${c.summary} ${c.project} ${c.tool}`.toLowerCase().includes(text))
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
    .map((g, index) => {
      const calls = g.calls.filter(matches);
      if (
        filtering &&
        !calls.length &&
        ($("#f-tool").value ||
          $("#f-decision").value ||
          (state.project && g.project !== state.project) ||
          ($("#f-text").value && !(g.text || "").toLowerCase().includes($("#f-text").value.toLowerCase())))
      )
        return "";
      const open = state.expanded.has(g.promptId);
      const blocked = g.denied
        ? `<span class="pill bad">${g.denied} denied</span>`
        : g.wouldDeny
          ? `<span class="pill warn">${g.wouldDeny} denied</span>`
          : "";
      const t = g.tokens || {};
      const text = g.text
        ? `<div class="pg-text">${esc(g.text)}</div>`
        : '<div class="pg-text none">Prompt text not available</div>';
      const body =
        open
          ? g.callCount === 0
            ? `<div class="pg-body pg-empty" id="prompt-body-${index}">No tool call yet.</div>`
            : `<div class="pg-body" id="prompt-body-${index}"><table><thead><tr><th>Time</th><th>Tool</th><th>Call</th><th>Tokens</th><th>Decision</th><th>Status</th></tr></thead>
        <tbody>${calls.map(callRow).join("")}</tbody></table></div>`
          : `<div id="prompt-body-${index}" hidden></div>`;
      return `<div class="pg ${open ? "open" : ""} ${g._new ? "new" : ""}" data-pid="${esc(g.promptId)}">
      <div class="pg-header">
      <button class="pg-head" aria-expanded="${open}" aria-controls="prompt-body-${index}">
        <svg class="icon chev"><use href="#i-chevron"/></svg>
        <div class="minw0">${text}
          <div class="pg-meta"><span>${esc(g.integration === "codex" ? "Codex" : "Claude Code")}</span><span>·</span><span>${esc(fmtTime(g.at))}</span><span>·</span><span>${esc(baseName(g.project))}</span><span>·</span>
            <span>${g.callCount} tool call${g.callCount === 1 ? "" : "s"}</span>${blocked}</div></div>
      </button>
      <div class="pg-right">
          <div class="pg-summary">
            ${g.text ? '<button class="btn sm pg-view" type="button" data-view-prompt aria-haspopup="dialog">View prompt</button>' : ""}
            <div class="tok">Tools ${fmtTok(t.result)} tok${t.saved > 0 ? ` <span class="saved">−${fmtTok(t.saved)} (${pct(t.saved, t.result)}%)</span>` : ""}</div>
          </div>
          <div class="usage">${esc(usageLine(g.usage))}</div>
      </div>
      </div>
      ${body}
    </div>`;
    })
    .join("");
  $("#grouped-view").innerHTML = html;
  for (const g of state.prompts.values()) g._new = false;
}

export function renderCalls() {
  const all = [...state.calls.values()];
  const rows = all.filter(matches);
  renderGrouped();
  for (const c of state.calls.values()) c._new = false;
  $("#calls-empty").hidden = state.calls.size > 0;
  $("#calls-count").textContent =
    `${state.prompts.size} prompts · ` +
    `Showing ${rows.length} of ${state.calls.size} calls`;
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
/** (Re)loads groups and calls, for the selected project only when one is set. */
export async function loadActivity() {
  const q = state.project ? `&project=${encodeURIComponent(state.project)}` : "";
  state.calls.clear();
  state.prompts.clear();
  state.expanded.clear();
  setPrompts(await api("GET", `/api/prompts?limit=40${q}`));
  upsertCalls(await api("GET", `/api/calls?limit=300${q}`), false);
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
$("#grouped-view").addEventListener("click", (e) => {
  const view = e.target.closest("[data-view-prompt]");
  if (view) {
    const pid = view.closest(".pg").dataset.pid;
    const group = state.prompts.get(pid);
    if (!group?.text) return;
    promptDialogId = pid;
    $("#prompt-title").textContent = "Prompt Detail";
    $("#prompt-meta").textContent =
      `${group.integration === "codex" ? "Codex" : "Claude Code"} · ${fmtTime(group.at)} · ${baseName(group.project)}`;
    $("#prompt-content").innerHTML = renderMarkdown(group.text);
    $("#prompt-dialog").showModal();
    $("#prompt-content").scrollTop = 0;
    return;
  }
  const head = e.target.closest(".pg-head");
  if (!head) return;
  const pid = head.closest(".pg").dataset.pid;
  if (state.expanded.has(pid)) state.expanded.delete(pid);
  else state.expanded.add(pid);
  renderCalls();
  [...$$("#grouped-view .pg")]
    .find((group) => group.dataset.pid === pid)
    ?.querySelector(".pg-head")
    ?.focus();
});
let promptDialogId = null;
$("#prompt-close").addEventListener("click", () => $("#prompt-dialog").close());
$("#prompt-dialog").addEventListener("close", () => {
  [...$$("#grouped-view .pg")]
    .find((group) => group.dataset.pid === promptDialogId)
    ?.querySelector("[data-view-prompt]")
    ?.focus();
  promptDialogId = null;
});
// ---------- call details ----------

let detailCall = null;

/** The command of a shell call, shown on its own above the input; null for other tools. */
const shellCommand = (c) =>
  (c.tool === "Bash" || c.tool === "PowerShell") && typeof c.input?.command === "string" ? c.input.command : null;

export async function openCall(id) {
  const c = await api("GET", `/api/calls/${id}`);
  detailCall = c;
  if (!state.strategies.length) state.strategies = (await api("GET", "/api/reduction")).strategies;
  $("#detail-title").textContent = `${c.tool} · call #${c.id}`;
  const json = (v) => esc(typeof v === "string" ? v : JSON.stringify(v, null, 2));
  const t = c.tokens || {};
  const saved = t.result != null ? t.result - (t.resultAfter ?? t.result) : 0;
  const breakdown = (Array.isArray(c.reduction) ? c.reduction : [])
    .map((b) => `<span>${esc(strategyTitle(b.id))}</span><span class="saved">−${fmtTok(b.saved)}</span>`)
    .join("");
  const rewrite = c.inputRewrite && c.inputRewrite.applied ? c.inputRewrite : null;
  const command = shellCommand(c);
  $("#detail-body").innerHTML = `
    <dl>
      ${c.description ? `<dt>Description</dt><dd>${esc(c.description)}</dd>` : ""}
      <dt>Decision</dt><dd>${decisionBadge(c.decision)}${reasonLong(c)}</dd>
      <dt>Started</dt><dd>${esc(fmtTime(c.startedAt))}${c.durationMs != null ? ` · took ${(c.durationMs / 1000).toFixed(2)}s` : ""}</dd>
      <dt>Project</dt><dd class="mono">${esc(c.project)}</dd>
      <dt>Integration</dt><dd>${esc(c.integration === "codex" ? "Codex" : "Claude Code")}</dd>
      <dt>Session</dt><dd class="mono">${esc(c.sessionId)}${c.agentId ? ` · agent ${esc(c.agentId)}` : ""}</dd>
      <dt>Tool use id</dt><dd class="mono">${esc(c.toolUseId)}</dd>
    </dl>
    <h3>Tokens (estimated)</h3>
    <dl class="flush">
      <dt>Agent wrote</dt><dd>${fmtTok(t.input)} tokens for the call</dd>
      <dt>Result</dt><dd>${t.result == null ? "—" : `${fmtTok(t.result)} tokens`}${saved > 0 ? ` → Agent received <b>${fmtTok(t.resultAfter)}</b> <span class="saved">(−${fmtTok(saved)}, ${pct(saved, t.result)}%)</span>` : ""}</dd>
    </dl>
    ${breakdown ? `<div class="breakdown">${breakdown}</div>` : ""}
    ${rewrite ? `<h3>Changed before it ran</h3><div class="muted text13">${rewrite.applied.map((id) => esc(strategyTitle(id))).join(", ")}</div><pre>${json(rewrite.notes.join("\n"))}</pre>` : ""}
    ${
      command !== null
        ? `<h3>Command</h3><div class="cmd-view"><pre class="cmd"><span class="prompt">${c.tool === "PowerShell" ? "PS&gt; " : "$ "}</span>${esc(command)}</pre>
      <button class="btn sm" type="button" data-copy>Copy</button></div>`
        : ""
    }
    <h3>Input</h3><pre>${json(c.input)}</pre>
    ${
      c.reducedResult != null
        ? `<div class="tabs"><button class="on" data-tab="sent">Sent to agent</button><button data-tab="orig">Original result</button></div>
      <pre data-pane="sent">${json(c.reducedResult)}</pre><pre data-pane="orig" hidden>${json(c.result)}</pre>`
        : `<h3>Result</h3><pre>${c.result == null ? '<span class="muted">—</span>' : json(c.result)}</pre>`
    }`;
  $("#detail").classList.add("open");
  $("#detail").setAttribute("aria-hidden", "false");
}

$("#page-calls").addEventListener("click", (e) => {
  if (e.target.closest("a")) return;
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
  if (e.target.closest("[data-copy]") && detailCall) {
    navigator.clipboard.writeText(shellCommand(detailCall) ?? "").then(
      () => toast("Command copied"),
      () => toast("Could not copy the command", true)
    );
    return;
  }
  if (e.target.closest("[data-allow]") && detailCall) {
    const id = detailCall.id;
    guard(openAllowDialog)(detailCall, { onChange: () => guard(openCall)(id), onLeave: closeDetail });
    return;
  }
  if (e.target.closest("a")) closeDetail();
});
export const closeDetail = () => {
  $("#detail").classList.remove("open");
  $("#detail").setAttribute("aria-hidden", "true");
};
$("#detail-close").addEventListener("click", closeDetail);
// Escape inside the allow dialog closes only the dialog.
document.addEventListener(
  "keydown",
  (e) => e.key === "Escape" && !$("#allow-dialog").open && !$("#prompt-dialog").open && closeDetail()
);

// ---------- resizing the details (drag the left edge; the width is remembered) ----------
const DRAWER_KEY = "apichap-gateway-drawer-width";
const DRAWER_MIN = 360;
const drawerMax = () => Math.max(DRAWER_MIN, window.innerWidth - 80);
function setDrawerWidth(px) {
  const w = Math.round(Math.min(Math.max(px, DRAWER_MIN), drawerMax()));
  $("#detail").style.setProperty("--drawer-w", `${w}px`);
  return w;
}
function saveDrawerWidth(w) {
  try {
    if (w === null) localStorage.removeItem(DRAWER_KEY);
    else localStorage.setItem(DRAWER_KEY, String(w));
  } catch {}
}
try {
  const saved = Number(localStorage.getItem(DRAWER_KEY));
  if (saved > 0) setDrawerWidth(saved);
} catch {}

const handle = $("#detail-resize");
handle.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  handle.setPointerCapture(e.pointerId);
  $("#detail").classList.add("resizing");
  document.body.classList.add("resizing");
});
handle.addEventListener("pointermove", (e) => {
  if (handle.hasPointerCapture(e.pointerId)) setDrawerWidth(window.innerWidth - e.clientX);
});
const endResize = (e) => {
  if (!handle.hasPointerCapture(e.pointerId)) return;
  handle.releasePointerCapture(e.pointerId);
  $("#detail").classList.remove("resizing");
  document.body.classList.remove("resizing");
  saveDrawerWidth(setDrawerWidth(window.innerWidth - e.clientX));
};
handle.addEventListener("pointerup", endResize);
handle.addEventListener("pointercancel", endResize);
handle.addEventListener("dblclick", () => {
  $("#detail").style.removeProperty("--drawer-w");
  saveDrawerWidth(null);
});
// Keyboard: arrow keys make the details wider or narrower.
handle.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  e.preventDefault();
  const current = $("#detail").getBoundingClientRect().width;
  saveDrawerWidth(setDrawerWidth(current + (e.key === "ArrowLeft" ? 40 : -40)));
});
