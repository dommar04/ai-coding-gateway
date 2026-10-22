// Entry point: navigation, sidebar, live stream, startup.
import { $, $$, api, guard, state, toast, token } from "./core.js";
import { fmtTok, pct } from "./format.js";
import { loadActivity, renderCalls, renderProjectOptions, setPrompts, upsertCalls } from "./activity.js";
import { loadStrategies } from "./savings.js";
import { loadRules } from "./rules.js";

// ---------- navigation ----------
const PAGES = ["calls", "rules", "savings", "settings"];
function showPage(page) {
  if (!PAGES.includes(page) || (page === "savings" && !featureOn("tokenSavings"))) page = "calls";
  state.page = page;
  $$("[data-page-section]").forEach((s) => (s.hidden = s.id !== `page-${page}`));
  $$("nav.menu a").forEach((a) => a.classList.toggle("active", a.dataset.page === page));
  // Settings has no menu item: it opens from the environment menu.
  $("#crumb").textContent = $(`nav.menu a[data-page="${page}"] .lbl`)?.textContent ?? "Settings";
  setEnvMenu(false);
  if (page === "rules") guard(loadRules)();
  if (page === "savings") guard(loadStrategies)();
}
window.addEventListener("hashchange", () => showPage(location.hash.slice(1)));

// The top bar's button hides and shows the sidebar; the choice is kept in this browser.
function setSidebar(open) {
  $("#app").classList.toggle("nav-collapsed", !open);
  $("#nav-toggle").setAttribute("aria-expanded", String(open));
  try {
    localStorage.setItem("sidebar", open ? "open" : "closed");
  } catch {
    // Storage blocked: the sidebar just opens again next time.
  }
}
$("#nav-toggle").addEventListener("click", () => setSidebar($("#app").classList.contains("nav-collapsed")));
try {
  if (localStorage.getItem("sidebar") === "closed") setSidebar(false);
} catch {
  // Storage blocked: keep it open.
}

// ---------- sidebar / stats ----------
/** Whether a feature is on; all are on until the stats say otherwise. */
const featureOn = (f) => state.stats?.features?.[f] !== false;

function renderStats() {
  const s = state.stats;
  if (!s) return;
  // The sidebar widget and the settings page both show the mode.
  $$("#modes button, #set-mode button").forEach((b) => {
    b.classList.toggle("on", b.dataset.mode === s.mode);
    b.setAttribute("aria-pressed", String(b.dataset.mode === s.mode));
  });
  // Features: the settings page's switches; token savings off hides its page, menu item and stat card.
  $$("#page-settings [data-feature]").forEach((input) => (input.checked = featureOn(input.dataset.feature)));
  const pipelines = $('#page-settings [data-feature="pipelines"]');
  pipelines.disabled = !featureOn("traces");
  pipelines.closest(".setting").classList.toggle("disabled", pipelines.disabled);
  pipelines.closest(".setting").title = pipelines.disabled
    ? "Needs trace files: the report is set up with a project's first one."
    : "";
  const savings = featureOn("tokenSavings");
  $('nav.menu a[data-page="savings"]').hidden = !savings;
  $(".stat-saved").hidden = !savings;
  if (!savings && state.page === "savings") location.hash = "calls";
  // Optional hint line under the modes. "off" has no button here; it is set on the settings page.
  const hint = $("#mode-hint");
  if (hint) {
    const active = $(`#modes button[data-mode="${s.mode}"]`);
    hint.textContent = active ? active.dataset.hint : "Checks are off (Settings). Pick a mode to turn them on.";
  }
  // Two stat cards, for all projects: "saved 11k of 74k", and denied calls.
  const t = s.tokens || {};
  const share = pct(t.savedTokens, t.resultTokens);
  $("#st-denied").textContent = Number(s.deniedCalls || 0).toLocaleString();
  $("#st-saved").textContent = fmtTok(t.savedTokens);
  $("#st-of").textContent = `of ${fmtTok(t.resultTokens)} · ${share}%`;
  $("#st-meter").style.width = `${Math.min(share, 100)}%`;
}

$$("#modes button, #set-mode button").forEach((b) =>
  b.addEventListener(
    "click",
    guard(async () => {
      if (b.dataset.mode === state.stats?.mode) return;
      if (
        b.dataset.mode === "enforce" &&
        !confirm("Switch to Enforce? Denied and unlisted tool calls will be denied in every connected agent session.")
      )
        return;
      if (b.dataset.mode === "off" && !confirm("Turn rules enforcement off? Tool calls are no longer checked against the rules."))
        return;
      await api("PUT", "/api/mode", { mode: b.dataset.mode });
      state.stats.mode = b.dataset.mode;
      renderStats();
      toast(`Mode set to ${b.dataset.mode}`);
    })
  )
);

// ---------- environment menu: where settings come from (local for now), and the way to Settings ----------
function setEnvMenu(open) {
  $("#env-menu").hidden = !open;
  $("#env").setAttribute("aria-expanded", String(open));
}
$("#env").addEventListener("click", () => setEnvMenu($("#env-menu").hidden));
document.addEventListener("click", (e) => {
  if (!$("#env-menu").hidden && !e.composedPath().includes($(".env-wrap"))) setEnvMenu(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#env-menu").hidden) {
    setEnvMenu(false);
    $("#env").focus();
  }
});
// ---------- settings page ----------
const FEATURE_NAMES = { tokenSavings: "Token savings", traces: "Trace files", pipelines: "Git pipeline report" };
$$("#page-settings [data-feature]").forEach((input) =>
  input.addEventListener(
    "change",
    guard(async () => {
      try {
        const { features } = await api("PUT", "/api/features", { feature: input.dataset.feature, on: input.checked });
        state.stats.features = features;
        toast(`${FEATURE_NAMES[input.dataset.feature]} ${input.checked ? "on" : "off"}`);
      } finally {
        renderStats(); // on failure: back to the stored state
      }
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
    upsertCalls(list, true);
  });
  es.addEventListener("prompts", (e) => {
    const list = JSON.parse(e.data).filter((p) => !state.project || p.project === state.project);
    setPrompts(list);
    renderCalls();
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
