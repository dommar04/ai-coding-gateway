// Entry point: navigation, sidebar, live stream, startup.
import { $, $$, api, guard, state, toast, token } from "./core.js";
import { fmtTok, pct } from "./format.js";
import { loadActivity, renderCalls, renderProjectOptions, upsertCalls } from "./activity.js";
import { loadStrategies } from "./savings.js";
import { loadRules } from "./rules.js";

// ---------- navigation ----------
const PAGES = ["calls", "rules", "savings"];
function showPage(page) {
  if (!PAGES.includes(page)) page = "calls";
  state.page = page;
  $$("[data-page-section]").forEach((s) => (s.hidden = s.id !== `page-${page}`));
  $$("nav.menu a").forEach((a) => a.classList.toggle("active", a.dataset.page === page));
  if (page === "rules") guard(loadRules)();
  if (page === "savings") guard(loadStrategies)();
}
window.addEventListener("hashchange", () => showPage(location.hash.slice(1)));

// ---------- sidebar / stats ----------
function renderStats() {
  const s = state.stats;
  if (!s) return;
  $$("#modes button").forEach((b) => {
    b.classList.toggle("on", b.dataset.mode === s.mode);
    b.setAttribute("aria-pressed", String(b.dataset.mode === s.mode));
  });
  // Optional hint line under the modes. "off" has no button here; it can only be set with the CLI.
  const hint = $("#mode-hint");
  if (hint) {
    const active = $(`#modes button[data-mode="${s.mode}"]`);
    hint.textContent = active ? active.dataset.hint : "Checks are off (set with the CLI). Pick a mode to turn them on.";
  }
  // Two stat cards, for all projects: "saved 11k of 74k", and denied calls.
  const t = s.tokens || {};
  const share = pct(t.savedTokens, t.resultTokens);
  $("#st-denied").textContent = Number(s.deniedCalls || 0).toLocaleString();
  $("#st-saved").textContent = fmtTok(t.savedTokens);
  $("#st-of").textContent = `of ${fmtTok(t.resultTokens)} · ${share}%`;
  $("#st-meter").style.width = `${Math.min(share, 100)}%`;
}

$$("#modes button").forEach((b) =>
  b.addEventListener(
    "click",
    guard(async () => {
      if (b.dataset.mode === state.stats?.mode) return;
      if (
        b.dataset.mode === "enforce" &&
        !confirm("Switch to Enforce? Denied and unlisted tool calls will be denied in every Claude Code session.")
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
  // The indicator only appears while the stream is down.
  es.addEventListener("open", () => ($("#conn").hidden = true));
  es.addEventListener("error", () => ($("#conn").hidden = false));
  es.addEventListener("calls", (e) => {
    const list = JSON.parse(e.data);
    if (state.paused) {
      state.queued.push(...list);
      renderCalls();
    } else upsertCalls(list, true);
  });
  es.addEventListener("stats", (e) => {
    state.stats = JSON.parse(e.data);
    renderStats();
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
