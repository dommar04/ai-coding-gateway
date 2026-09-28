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
  paused: false,
  queued: [],
  rules: [],
  groups: [],
  openGroups: new Set(),
  editingGroup: null,
  strategies: [],
  tools: new Set(),
  ruleEffect: "",
  page: "calls",
};
export const MAX_CALLS = 1000;

state.project = "";
state.projects = [];
try {
  state.project = localStorage.getItem("apichap-gateway-project") || "";
} catch {}
