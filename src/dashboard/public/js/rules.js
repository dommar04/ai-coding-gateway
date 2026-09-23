// Rules page: rules table, test box, add rule, import/export/defaults.
import { $, $$, api, esc, guard, managed, state, toast, token } from "./core.js";

// ---------- rules ----------
export async function loadRules() {
  const [rules, defaults] = await Promise.all([api("GET", "/api/rules"), api("GET", "/api/rules/defaults")]);
  state.rules = rules;
  state.defaults = defaults;
  renderRules();
  renderDefaultsBanner();
}

// ---------- rule files: export / import / defaults ----------
export function renderDefaultsBanner() {
  const d = state.defaults;
  const el = $("#defaults-banner");
  if (!d || managed() || d.importedVersion >= d.version) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `<div class="banner info banner-actions">
    <div class="banner-text"><b>Updated default rules are available</b> (${esc(d.name)} v${d.version}, ${d.rules} rules${d.importedVersion ? `; yours are based on v${d.importedVersion}` : ""}).</div>
    <button class="btn sm" data-defaults="merge" title="Keep all your rules, add the default rules you don't have yet">Add missing defaults</button>
    <button class="btn sm primary" data-defaults="replace" title="Delete all rules and use the default rules">Replace all</button>
  </div>`;
}

export async function applyDefaults(mode) {
  const n = state.rules.length;
  const question =
    mode === "merge"
      ? "Add the default rules you don't have yet? Your existing rules stay unchanged."
      : `Replace all ${n} rules with the default rules? Rules you added or approved are deleted. Export first if you want to keep them.`;
  if (!confirm(question)) return;
  const r = await api("POST", "/api/rules/reset", { mode });
  toast(mode === "merge" ? `Added ${r.added} default rules` : `Reset to defaults: ${r.total} rules`);
  await loadRules();
}

$("#defaults-banner").addEventListener(
  "click",
  guard(async (e) => {
    const btn = e.target.closest("[data-defaults]");
    if (btn) await applyDefaults(btn.dataset.defaults);
  })
);
$("#rules-reset").addEventListener(
  "click",
  guard(() => applyDefaults("replace"))
);

$("#rules-export").addEventListener(
  "click",
  guard(async () => {
    const res = await fetch("/api/rules/export", { headers: { "X-Gateway-Token": token } });
    if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
    const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || "apichap-gateway-rules.json";
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  })
);

$("#rules-import").addEventListener("click", () => $("#rules-file").click());
$("#rules-file").addEventListener(
  "change",
  guard(async (e) => {
    const input = e.target;
    const f = input.files && input.files[0];
    input.value = "";
    if (!f) return;
    let file;
    try {
      file = JSON.parse((await f.text()).replace(/^﻿/, ""));
    } catch {
      throw new Error(`${f.name} is not valid JSON`);
    }
    const count = (Array.isArray(file.allow) ? file.allow.length : 0) + (Array.isArray(file.deny) ? file.deny.length : 0);
    const label = file.name ? `"${file.name}"` : f.name;
    if (
      !confirm(
        `Replace all ${state.rules.length} current rules with the ${count} rules from ${label}? This cannot be undone. Export first if you want to keep the current rules.`
      )
    )
      return;
    const r = await api("POST", "/api/rules/import", { file, mode: "replace" });
    toast(`Imported ${r.added} rules (${r.removed} replaced)`);
    await loadRules();
  })
);

$$("#rules-effect button").forEach((b) =>
  b.addEventListener("click", () => {
    state.ruleEffect = b.dataset.effect;
    $$("#rules-effect button").forEach((x) => x.classList.toggle("on", x === b));
    renderRules();
  })
);

export function renderRules() {
  const f = $("#rules-filter").value.toLowerCase();
  const ro = managed();
  const rows = state.rules
    .filter((r) => !state.ruleEffect || r.effect === state.ruleEffect)
    .filter((r) => !f || `${r.rule} ${r.note ?? ""} ${r.effect} ${r.source}`.toLowerCase().includes(f))
    .sort((a, b) => (a.effect === b.effect ? a.id - b.id : a.effect === "deny" ? -1 : 1));
  $("#rules-count").textContent = `${rows.length} of ${state.rules.length}`;
  $("#rules tbody").innerHTML =
    rows
      .map(
        (r) => `
    <tr data-id="${r.id}" class="${r.enabled ? "" : "disabled-row"}">
      <td class="muted">${r.id}</td>
      <td><span class="badge b-${r.effect}">${r.effect}</span></td>
      <td class="mono">${esc(r.rule)}</td>
      <td>${esc(r.note)}</td>
      <td class="muted">${esc(r.source)}</td>
      <td><label class="switch"><input type="checkbox" data-act="toggle" ${r.enabled ? "checked" : ""} ${ro ? "disabled" : ""} aria-label="Rule enabled"><span></span></label></td>
      <td>${ro ? "" : '<button class="btn sm ghost-danger" data-act="delete">Delete</button>'}</td>
    </tr>`
      )
      .join("") || '<tr><td colspan="7" class="empty">No rules match.</td></tr>';
}
$("#rules-filter").addEventListener("input", renderRules);

$("#rules tbody").addEventListener(
  "change",
  guard(async (e) => {
    const el = e.target.closest('[data-act="toggle"]');
    if (!el) return;
    const id = el.closest("tr").dataset.id;
    await api("PATCH", `/api/rules/${id}`, { enabled: el.checked });
    state.rules.find((r) => String(r.id) === id).enabled = el.checked ? 1 : 0;
    renderRules();
  })
);
$("#rules tbody").addEventListener(
  "click",
  guard(async (e) => {
    const el = e.target.closest('[data-act="delete"]');
    if (!el) return;
    const id = el.closest("tr").dataset.id;
    const rule = state.rules.find((r) => String(r.id) === id);
    if (!confirm(`Delete ${rule.effect} rule #${id}: ${rule.rule}?`)) return;
    await api("DELETE", `/api/rules/${id}`);
    toast(`Rule #${id} deleted`);
    await loadRules();
  })
);

$("#add-form").addEventListener(
  "submit",
  guard(async (e) => {
    e.preventDefault();
    const r = await api("POST", "/api/rules", {
      effect: $("#add-effect").value,
      rule: $("#add-rule").value,
      note: $("#add-note").value,
    });
    toast(`Added rule #${r.id}`);
    $("#add-rule").value = $("#add-note").value = "";
    await loadRules();
    runTest();
  })
);

export let testTimer;
export async function runTest() {
  const call = $("#test-input").value.trim();
  const out = $("#test-result");
  if (!call) {
    out.innerHTML =
      '<span class="muted">Type a call, e.g. <code>Bash(npm run build)</code> or <code>Edit(C:/work/app/src/a.ts)</code>.</span>';
    return;
  }
  try {
    const v = await api("POST", "/api/rules/test", { call });
    const parts = v.parts
      .map(
        (p) => `<div>${p.allowedBy ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>'} <code>${esc(p.part)}</code>
      <span class="muted">${p.allowedBy ? `allow #${p.allowedBy.id} ${esc(p.allowedBy.rule)}` : "no allow rule"}</span></div>`
      )
      .join("");
    const verdict =
      v.decision === "allow"
        ? '<span class="ok">Allowed</span>'
        : v.reason === "rule"
          ? `<span class="bad">Denied</span> by deny #${v.rule.id} <code>${esc(v.rule.rule)}</code> <span class="muted">${esc(v.rule.note)}</span>`
          : '<span class="bad">Denied</span> <span class="muted">not on the allowlist, would file an approval request</span>';
    out.innerHTML = parts + `<div class="mt4">${verdict}</div>`;
  } catch (e) {
    out.innerHTML = `<span class="bad">${esc(e.message)}</span>`;
  }
}
$("#test-input").addEventListener("input", () => {
  clearTimeout(testTimer);
  testTimer = setTimeout(runTest, 200);
});
