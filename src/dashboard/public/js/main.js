// Entry point: navigation, sidebar, live stream, startup.
import { $, $$, api, guard, managed, state, toast, token, ui } from "./core.js";
import { fmtTok, pct } from "./format.js";
import { loadActivity, renderCalls, renderProjectOptions, upsertCalls } from "./activity.js";
import { loadStrategies, renderSavingsTotals } from "./savings.js";
import { loadRequests } from "./approvals.js";
import { loadRules } from "./rules.js";

// ---------- navigation ----------
const PAGES = ["calls", "approvals", "rules", "savings"];
function showPage(page) {
  if (!PAGES.includes(page)) page = "calls";
  state.page = page;
  $$("[data-page-section]").forEach((s) => (s.hidden = s.id !== `page-${page}`));
  $$("nav.menu a").forEach((a) => a.classList.toggle("active", a.dataset.page === page));
  if (page === "approvals") guard(loadRequests)();
  if (page === "rules") guard(loadRules)();
  if (page === "savings") guard(loadStrategies)();
}
window.addEventListener("hashchange", () => showPage(location.hash.slice(1)));

// ---------- sidebar / stats ----------
ui.renderStats = renderStats;

function renderStats() {
  const s = state.stats;
  if (!s) return;
  $$("#modes button").forEach((b) => {
    b.classList.toggle("on", b.dataset.mode === s.mode);
    b.disabled = managed();
  });
  const pc = $("#pending-count");
  pc.hidden = !s.pendingRequests;
  pc.textContent = s.pendingRequests;
  $("#k-pending").textContent = s.pendingRequests;
  const t = (state.project && state.projectTokens) || s.tokens || {};
  $("#k-tokens").textContent = fmtTok(t.resultTokens);
  $("#k-tokens-sub").textContent =
    `in ${Number(t.calls || 0).toLocaleString()} calls${state.project ? " · this project" : ""} · estimated`;
  $("#k-saved").textContent = fmtTok(t.savedTokens);
  $("#k-saved-sub").textContent =
    `${pct(t.savedTokens, t.resultTokens)}% of tool results` +
    (t.potentialTokens ? ` · ${fmtTok(t.potentialTokens)} more possible` : "");
  $("#banner").innerHTML = managed()
    ? '<div class="banner info">Rules are managed by your organization. You can follow your calls and the status of your approval requests, but not change rules.</div>'
    : s.mode === "monitor"
      ? '<div class="banner warn"><b>Monitor mode.</b>&nbsp;Calls are checked and logged, but nothing is blocked. Switch to Enforce when the rules look right.</div>'
      : s.mode === "off"
        ? '<div class="banner warn"><b>Checks are off.</b>&nbsp;Tool calls are only logged.</div>'
        : "";
  $("#add-form")
    .querySelectorAll("input,select,button")
    .forEach((el) => (el.disabled = managed()));
  $$(".needs-local").forEach((el) => (el.disabled = managed()));
  if (state.page === "savings") renderSavingsTotals(s.tokens || {});
}

$$("#modes button").forEach((b) =>
  b.addEventListener(
    "click",
    guard(async () => {
      if (b.dataset.mode === state.stats?.mode) return;
      if (
        b.dataset.mode === "enforce" &&
        !confirm("Switch to Enforce? Denied and unlisted tool calls will be blocked in every Claude Code session.")
      )
        return;
      await api("PUT", "/api/mode", { mode: b.dataset.mode });
      state.stats.mode = b.dataset.mode;
      renderStats();
      toast(`Mode set to ${b.dataset.mode}`);
    })
  )
);

// ---------- live stream ----------
function connect() {
  const es = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`);
  const setConn = (cls, text) => {
    $("#live-dot").className = `dot ${cls}`;
    $("#live-text").textContent = text;
  };
  es.addEventListener("open", () => setConn("live", "Live"));
  es.addEventListener("error", () => setConn("down", "Reconnecting…"));
  es.addEventListener("calls", (e) => {
    const list = JSON.parse(e.data);
    if (state.paused) {
      state.queued.push(...list);
      renderCalls();
    } else upsertCalls(list, true);
  });
  es.addEventListener("stats", (e) => {
    const prev = state.stats;
    state.stats = JSON.parse(e.data);
    renderStats();
    if (prev && state.page === "approvals" && prev.pendingRequests !== state.stats.pendingRequests) guard(loadRequests)();
    if (prev && prev.policySource !== state.stats.policySource) showPage(state.page);
  });
}

if (!token) {
  $("#banner").innerHTML =
    '<div class="banner error">Missing access token. Open the URL printed by <code>apichap-gateway dashboard</code> in your terminal.</div>';
} else {
  // Stream first, then history: anything arriving in between is merged by id.
  connect();
  guard(async () => {
    state.stats = await api("GET", "/api/stats");
    renderStats();
    showPage(location.hash.slice(1) || "calls");
    state.projects = await api("GET", "/api/projects");
    renderProjectOptions();
    await loadActivity();
  })();
}
