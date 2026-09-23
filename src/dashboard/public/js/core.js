// Shared basics: DOM helpers, access token, API calls, toasts, app state.

// ---------- token ----------
export const params = new URLSearchParams(location.search);
export let token = params.get("token");
try {
  if (token) sessionStorage.setItem("apichap-gateway-token", token);
  else token = sessionStorage.getItem("apichap-gateway-token");
} catch {}
if (params.has("token")) history.replaceState(null, "", location.pathname + location.hash);

export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => document.querySelectorAll(sel);
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "X-Gateway-Token": token, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export let toastTimer;
export function toast(msg, isError) {
  const el = $("#toast");
  el.textContent = msg;
  el.className = "show" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), isError ? 5000 : 2800);
}
export const guard =
  (fn) =>
  async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      toast(e.message, true);
    }
  };

// ---------- state ----------
export const state = {
  stats: null,
  calls: new Map(),
  prompts: new Map(),
  expanded: new Set(),
  view: "grouped",
  paused: false,
  queued: [],
  rules: [],
  requests: [],
  strategies: [],
  tools: new Set(),
  reqStatus: "pending",
  ruleEffect: "",
  page: "calls",
};
export const MAX_CALLS = 1000;
export const managed = () => state.stats && state.stats.policySource === "managed";

/** Hooks filled in by main.js, so page modules can refresh shared UI without importing main. */
export const ui = { renderStats: () => {} };
try {
  state.view = localStorage.getItem("apichap-gateway-view") || "grouped";
} catch {}
state.project = "";
state.projects = [];
state.projectTokens = null;
try {
  state.project = localStorage.getItem("apichap-gateway-project") || "";
} catch {}
