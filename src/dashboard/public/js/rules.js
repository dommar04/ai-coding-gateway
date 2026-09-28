// Rules page: rule groups (one policy each, with its rules), test box, import/export/defaults.
import { $, $$, api, esc, guard, state, toast, token } from "./core.js";

// ---------- loading ----------
export async function loadRules() {
  const [rules, groups, defaults] = await Promise.all([
    api("GET", "/api/rules"),
    api("GET", "/api/rule-groups"),
    api("GET", "/api/rules/defaults"),
  ]);
  state.rules = rules;
  state.groups = groups;
  state.defaults = defaults;
  renderRules();
  renderDefaultsBanner();
}

/** "deny" when a group only blocks, "allow" when it only allows, "mixed" otherwise (also when empty). */
function groupKind(rules) {
  if (!rules.length) return "mixed";
  if (rules.every((r) => r.effect === "deny")) return "deny";
  if (rules.every((r) => r.effect === "allow")) return "allow";
  return "mixed";
}

const KIND = {
  deny: { icon: "i-ban", heading: "Not allowed", sub: "Denied, even if an allow rule matches too." },
  allow: { icon: "i-check-circle", heading: "Allowed", sub: "Anything these groups don't cover is denied." },
  mixed: { icon: "i-help-circle", heading: "Mixed and empty groups", sub: "Groups with both allow and deny rules, or none yet." },
};

function groupsWithRules() {
  const byGroup = new Map(state.groups.map((g) => [g.id, []]));
  for (const r of state.rules) byGroup.get(r.group_id)?.push(r);
  return state.groups.map((g) => {
    const rules = byGroup.get(g.id).sort((a, b) => (a.effect === b.effect ? a.id - b.id : a.effect === "deny" ? -1 : 1));
    return { ...g, rules, kind: groupKind(rules) };
  });
}

$("#policy-summary").addEventListener("click", (e) => {
  const b = e.target.closest("[data-effect-jump]");
  if (!b) return;
  setEffect(b.dataset.effectJump);
  $("#rule-groups").scrollIntoView({ behavior: "smooth", block: "start" });
});

// ---------- groups ----------
function setEffect(effect) {
  state.ruleEffect = effect;
  $$("#rules-effect button").forEach((x) => x.classList.toggle("on", x.dataset.effect === effect));
  renderRules();
}
$$("#rules-effect button").forEach((b) => b.addEventListener("click", () => setEffect(b.dataset.effect)));
$("#rules-filter").addEventListener("input", renderRules);

export function renderRules() {
  const all = groupsWithRules();
  const f = $("#rules-filter").value.trim().toLowerCase();
  const effect = state.ruleEffect;

  const visible = [];
  for (const g of all) {
    const groupHit = !f || `${g.title} ${g.description ?? ""} ${g.key}`.toLowerCase().includes(f);
    const rules = g.rules
      .filter((r) => !effect || r.effect === effect)
      .filter((r) => groupHit || `${r.rule} ${r.note ?? ""} ${r.source}`.toLowerCase().includes(f));
    if (effect && !rules.length) continue;
    if (!groupHit && !rules.length) continue;
    // A filter that matched rules only opens the group to show them.
    visible.push({ ...g, shown: rules, open: state.openGroups.has(g.id) || (!!f && !groupHit) });
  }

  const shownRules = visible.reduce((n, g) => n + g.shown.length, 0);
  $("#rules-count").textContent =
    f || effect
      ? `${visible.length} of ${all.length} groups · ${shownRules} of ${state.rules.length} rules`
      : `${all.length} groups · ${state.rules.length} rules`;

  if (!visible.length) {
    $("#rule-groups").innerHTML =
      `<div class="empty">${all.length ? "No groups or rules match." : "No rules yet. Import a rule file or reset to the defaults."}</div>`;
    return;
  }
  const others = all.filter((g) => g.id);
  $("#rule-groups").innerHTML = ["deny", "allow", "mixed"]
    .map((kind) => {
      const list = visible.filter((g) => g.kind === kind);
      if (!list.length) return "";
      return `<div class="rg-section rg-section-${kind}"><h3>${KIND[kind].heading}</h3><span>${KIND[kind].sub}</span></div>
        ${list.map((g) => groupHtml(g, others)).join("")}`;
    })
    .join("");
}

function groupHtml(g, allGroups) {
  const off = g.rules.filter((r) => !r.enabled).length;
  const counts = [
    `${g.rules.length} rule${g.rules.length === 1 ? "" : "s"}`,
    ...(g.kind === "mixed" && g.rules.length
      ? [
          `${g.rules.filter((r) => r.effect === "deny").length} deny · ${g.rules.filter((r) => r.effect === "allow").length} allow`,
        ]
      : []),
    ...(off ? [`${off} off`] : []),
  ].join(" · ");
  const editing = state.editingGroup === g.id;
  return `<div class="rg rg-${g.kind}${g.open ? " open" : ""}${g.enabled ? "" : " off"}" data-gid="${g.id}">
    <div class="rg-head">
      <button class="rg-main" data-act="expand" aria-expanded="${g.open}">
        <svg class="icon chev"><use href="#i-chevron"/></svg>
        <svg class="icon rg-icon"><use href="#${KIND[g.kind].icon}"/></svg>
        <span class="rg-text"><span class="rg-title">${esc(g.title)}</span>${g.description ? `<span class="rg-desc">${esc(g.description)}</span>` : ""}</span>
      </button>
      <span class="rg-count">${esc(counts)}${g.enabled ? "" : ' · <span class="pill">switched off</span>'}</span>
      <label class="switch" title="${g.enabled ? "Switch off every rule in this group" : "Switch this group on"}"><input type="checkbox" data-act="group-toggle" ${g.enabled ? "checked" : ""} aria-label="Group enabled"><span></span></label>
    </div>
    ${g.open ? groupBody(g, allGroups, editing) : ""}
  </div>`;
}

function groupBody(g, allGroups, editing) {
  const moveTargets = allGroups.filter((x) => x.id !== g.id);
  const rows = g.shown
    .map(
      (r) => `<tr data-id="${r.id}" class="${r.enabled ? "" : "disabled-row"}">
        <td><span class="badge b-${r.effect}">${r.effect}</span></td>
        <td class="mono rule-cell">${esc(r.rule)}</td>
        <td class="note-cell">${esc(r.note)}</td>
        <td class="muted">${esc(r.source)}</td>
        <td><label class="switch"><input type="checkbox" data-act="toggle" ${r.enabled ? "checked" : ""} aria-label="Rule enabled"><span></span></label></td>
        <td class="rule-actions">${
          moveTargets.length
            ? `<select class="sm" data-act="move" aria-label="Move to group"><option value="">Move to…</option>${moveTargets
                .map((x) => `<option value="${x.id}">${esc(x.title)}</option>`)
                .join("")}</select>`
            : ""
        }<button class="btn sm ghost-danger" data-act="delete">Delete</button></td>
      </tr>`
    )
    .join("");
  const hidden = g.rules.length - g.shown.length;
  const defaultEffect = g.kind === "allow" ? "allow" : "deny";
  return `<div class="rg-body">
    ${
      editing
        ? `<form class="form group-form rg-edit" data-act="save-group">
        <input type="text" name="title" value="${esc(g.title)}" aria-label="Group title" required />
        <input type="text" name="description" value="${esc(g.description)}" placeholder="Why, and what it covers (optional)" aria-label="Description" />
        <div class="row"><span class="grow"></span><button class="btn" type="button" data-act="cancel-edit">Cancel</button><button class="btn primary" type="submit">Save</button></div>
      </form>`
        : ""
    }
    ${
      g.shown.length
        ? `<div class="table-wrap"><table class="rg-rules"><tbody>${rows}</tbody></table></div>`
        : `<div class="empty compact">${g.rules.length ? "No rules match the filter." : "No rules in this group yet. Add the first one below."}</div>`
    }
    ${hidden ? `<div class="rg-hidden muted small">${hidden} more rule${hidden === 1 ? "" : "s"} hidden by the filter.</div>` : ""}
    <form class="rg-add" data-act="add-rule">
      <select name="effect" aria-label="Effect"><option value="deny" ${defaultEffect === "deny" ? "selected" : ""}>deny</option><option value="allow" ${defaultEffect === "allow" ? "selected" : ""}>allow</option></select>
      <input type="text" name="rule" class="mono" placeholder="${defaultEffect === "deny" ? "Shell(docker system prune*)" : "Shell(docker compose *)"}" aria-label="Rule" required />
      <input type="text" name="note" placeholder="Note (optional)" aria-label="Note" />
      <button class="btn primary" type="submit">Add rule</button>
    </form>
    <div class="rg-actions">
      <button class="btn sm" data-act="edit-group">Rename or describe</button>
      <span class="grow"></span>
      <button class="btn sm ghost-danger" data-act="delete-group">Delete group</button>
    </div>
  </div>`;
}

const groupOf = (el) => state.groups.find((g) => String(g.id) === el.closest(".rg").dataset.gid);
const ruleOf = (el) => state.rules.find((r) => String(r.id) === el.closest("tr").dataset.id);

$("#rule-groups").addEventListener(
  "click",
  guard(async (e) => {
    const el = e.target.closest("[data-act]");
    if (!el || el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "FORM") return;
    const act = el.dataset.act;
    const g = groupOf(el);
    if (act === "expand") {
      if (state.openGroups.has(g.id)) state.openGroups.delete(g.id);
      else state.openGroups.add(g.id);
      renderRules();
    } else if (act === "edit-group") {
      state.editingGroup = g.id;
      renderRules();
      $(`.rg[data-gid="${g.id}"] .rg-edit input`)?.focus();
    } else if (act === "cancel-edit") {
      state.editingGroup = null;
      renderRules();
    } else if (act === "delete-group") {
      const n = state.rules.filter((r) => r.group_id === g.id).length;
      if (!confirm(`Delete the group "${g.title}"${n ? ` and its ${n} rule${n === 1 ? "" : "s"}` : ""}?`)) return;
      await api("DELETE", `/api/rule-groups/${g.id}`);
      toast("Group deleted");
      await loadRules();
    } else if (act === "delete") {
      const rule = ruleOf(el);
      if (!confirm(`Delete ${rule.effect} rule #${rule.id}: ${rule.rule}?`)) return;
      await api("DELETE", `/api/rules/${rule.id}`);
      toast(`Rule #${rule.id} deleted`);
      await loadRules();
    }
  })
);

$("#rule-groups").addEventListener(
  "change",
  guard(async (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    if (el.dataset.act === "group-toggle") {
      const g = groupOf(el);
      await api("PATCH", `/api/rule-groups/${g.id}`, { enabled: el.checked });
      g.enabled = el.checked ? 1 : 0;
      toast(el.checked ? "Group switched on" : "Group switched off: its rules no longer apply");
      renderRules();
    } else if (el.dataset.act === "toggle") {
      const rule = ruleOf(el);
      await api("PATCH", `/api/rules/${rule.id}`, { enabled: el.checked });
      rule.enabled = el.checked ? 1 : 0;
      renderRules();
    } else if (el.dataset.act === "move" && el.value) {
      const rule = ruleOf(el);
      const target = state.groups.find((g) => String(g.id) === el.value);
      await api("PATCH", `/api/rules/${rule.id}`, { groupId: target.id });
      state.openGroups.add(target.id);
      toast(`Moved to "${target.title}"`);
      await loadRules();
    }
  })
);

$("#rule-groups").addEventListener(
  "submit",
  guard(async (e) => {
    const form = e.target.closest("form[data-act]");
    if (!form) return;
    e.preventDefault();
    const g = groupOf(form);
    if (form.dataset.act === "add-rule") {
      const data = new FormData(form);
      const r = await api("POST", "/api/rules", {
        effect: data.get("effect"),
        rule: data.get("rule"),
        note: data.get("note"),
        groupId: g.id,
      });
      toast(`Added rule #${r.id}`);
      await loadRules();
      $(`.rg[data-gid="${g.id}"] .rg-add input[name="rule"]`)?.focus();
      runTest();
    } else if (form.dataset.act === "save-group") {
      const data = new FormData(form);
      await api("PATCH", `/api/rule-groups/${g.id}`, { title: data.get("title"), description: data.get("description") });
      state.editingGroup = null;
      toast("Group saved");
      await loadRules();
    }
  })
);

// ---------- new group ----------
function showNewGroup(show) {
  $("#group-new").hidden = !show;
  if (show) $("#group-new-title").focus();
  else $("#group-new-title").value = $("#group-new-desc").value = "";
}
$("#group-new-toggle").addEventListener("click", () => showNewGroup($("#group-new").hidden));
$("#group-new-cancel").addEventListener("click", () => showNewGroup(false));
$("#group-new").addEventListener(
  "submit",
  guard(async (e) => {
    e.preventDefault();
    const { id } = await api("POST", "/api/rule-groups", {
      title: $("#group-new-title").value,
      description: $("#group-new-desc").value,
    });
    showNewGroup(false);
    state.openGroups.add(id);
    setEffect("");
    $("#rules-filter").value = "";
    await loadRules();
    const el = $(`.rg[data-gid="${id}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.querySelector('.rg-add input[name="rule"]')?.focus();
    toast("Group created. Now add its rules.");
  })
);

// ---------- test a call ----------
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
    const policy = (r) => (r.group ? ` <span class="muted">· ${esc(r.group)}</span>` : "");
    const parts = v.parts
      .map(
        (p) => `<div>${p.allowedBy ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>'} <code>${esc(p.part)}</code>
      <span class="muted">${p.allowedBy ? `allow #${p.allowedBy.id} ${esc(p.allowedBy.rule)}` : "no allow rule"}</span>${p.allowedBy ? policy(p.allowedBy) : ""}</div>`
      )
      .join("");
    const verdict =
      v.decision === "allow"
        ? '<span class="ok">Allowed</span>'
        : v.reason === "rule"
          ? `<span class="bad">Not allowed</span>${v.rule.group ? `: <b>${esc(v.rule.group)}</b>` : ""} <span class="muted">(deny #${v.rule.id} <code>${esc(v.rule.rule)}</code>${v.rule.note ? ` · ${esc(v.rule.note)}` : ""})</span>`
          : '<span class="bad">Denied</span> <span class="muted">no rule allows it</span>';
    out.innerHTML = parts + `<div class="mt4">${verdict}</div>`;
  } catch (e) {
    out.innerHTML = `<span class="bad">${esc(e.message)}</span>`;
  }
}
$("#test-input").addEventListener("input", () => {
  clearTimeout(testTimer);
  testTimer = setTimeout(runTest, 200);
});
const testDialog = $("#test-dialog");
$("#rules-test").addEventListener("click", () => {
  testDialog.showModal();
  $("#test-input").select(); // keeps the last call, ready to change or retype
  runTest();
});
$$("#test-dialog [data-close]").forEach((b) => b.addEventListener("click", () => testDialog.close()));

// ---------- export ----------
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

// ---------- import / defaults dialog ----------
// source "file": a rule file the user picks; source "defaults": the built-in default rules.
const dialog = $("#import-dialog");
const imp = { source: "file", file: null, fileName: "", preview: null };

function openImport(source, mode) {
  imp.source = source;
  imp.file = null;
  imp.preview = null;
  $("#import-title").textContent = source === "defaults" ? "Default rules" : "Import rules";
  $("#import-drop").hidden = source === "defaults";
  $("#import-merge-label").textContent = source === "defaults" ? "Add the missing defaults" : "Add to my rules";
  $("#import-replace-label").textContent =
    source === "defaults" ? "Replace all my rules with the defaults" : "Replace all my rules";
  $(`input[name="import-mode"][value="${mode}"]`).checked = true;
  renderImport();
  dialog.showModal();
  if (source === "defaults") guard(loadPreview)(() => api("GET", "/api/rules/defaults/preview"), "default rules");
}

async function loadPreview(fetchPreview, label) {
  $("#import-preview").innerHTML = '<div class="muted small">Checking…</div>';
  try {
    imp.preview = await fetchPreview();
    imp.fileName = label;
  } catch (e) {
    imp.preview = null;
    $("#import-preview").innerHTML =
      `<div class="banner error import-error"><div><b>${esc(label)} can't be imported.</b><pre>${esc(e.message)}</pre></div></div>`;
    renderImport(true);
    return;
  }
  renderImport();
}

function importMode() {
  return $('input[name="import-mode"]:checked').value;
}

function renderImport(keepPreview) {
  const p = imp.preview;
  $("#import-modes").hidden = !p;
  $("#import-apply").disabled = !p;
  if (!p) {
    if (!keepPreview) $("#import-preview").innerHTML = "";
    $("#import-summary").textContent = "";
    return;
  }
  const mode = importMode();
  const groups = p.groups
    .map((g) => {
      const kind = g.deny && g.allow ? "mixed" : g.deny ? "deny" : g.allow ? "allow" : "mixed";
      const counts =
        [g.deny ? `${g.deny} deny` : "", g.allow ? `${g.allow} allow` : ""].filter(Boolean).join(" · ") || "no rules";
      const status =
        mode === "replace"
          ? ""
          : g.exists
            ? g.newRules
              ? `<span class="pill">adds ${g.newRules} to your group</span>`
              : '<span class="pill">already there</span>'
            : '<span class="pill new">new group</span>';
      return `<li class="ip-${kind}"><svg class="icon"><use href="#${KIND[kind].icon}"/></svg>
        <span class="ip-title">${esc(g.title)}</span><span class="muted small">${counts}</span>${status}</li>`;
    })
    .join("");
  $("#import-preview").innerHTML = `<div class="ip-head">
      <div><b>${esc(p.name || imp.fileName)}</b>${p.version ? ` <span class="muted">v${p.version}</span>` : ""}</div>
      ${p.description ? `<div class="muted small">${esc(p.description)}</div>` : ""}
      <div class="muted small">${p.groups.length} group${p.groups.length === 1 ? "" : "s"} · ${p.rules} rules${imp.source === "file" ? ` · ${esc(imp.fileName)}` : ""}</div>
      ${p.legacy ? '<div class="note-line muted">This file uses the older format without groups. Its rules are imported as one group; you can move them into groups afterwards.</div>' : ""}
    </div>
    <ul class="ip-groups">${groups}</ul>`;

  const summary = $("#import-summary");
  if (mode === "merge") {
    const newGroups = p.groups.filter((g) => !g.exists).length;
    summary.className = "import-summary";
    summary.textContent = p.newRules
      ? `Adds ${p.newRules} rule${p.newRules === 1 ? "" : "s"}${newGroups ? ` and ${newGroups} group${newGroups === 1 ? "" : "s"}` : ""}. Nothing is removed.`
      : "You already have every rule in this file.";
    $("#import-apply").textContent = imp.source === "defaults" ? "Add missing defaults" : "Add rules";
    $("#import-apply").disabled = !p.newRules && !newGroups;
    $("#import-apply").classList.remove("danger");
  } else {
    summary.className = "import-summary warn";
    summary.textContent = `Deletes your ${p.current.rules} rules in ${p.current.groups} groups. Export first to keep them.`;
    $("#import-apply").textContent = "Replace all rules";
    $("#import-apply").classList.add("danger");
  }
}
$$('input[name="import-mode"]').forEach((r) => r.addEventListener("change", () => renderImport()));

async function pickFile(f) {
  if (!f) return;
  let file;
  try {
    file = JSON.parse((await f.text()).replace(/^﻿/, ""));
  } catch {
    imp.preview = null;
    $("#import-preview").innerHTML = `<div class="banner error"><b>${esc(f.name)} is not valid JSON.</b></div>`;
    renderImport(true);
    return;
  }
  imp.file = file;
  await loadPreview(() => api("POST", "/api/rules/import/preview", { file }), f.name);
}

$("#rules-import").addEventListener("click", () => openImport("file", "merge"));
$("#rules-reset").addEventListener("click", () => openImport("defaults", "replace"));
$("#rules-file").addEventListener(
  "change",
  guard(async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    await pickFile(f);
  })
);
const drop = $("#import-drop");
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener(
  "drop",
  guard(async (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    await pickFile(e.dataTransfer.files[0]);
  })
);
$$("#import-dialog [data-close]").forEach((b) => b.addEventListener("click", () => dialog.close()));

$("#import-apply").addEventListener(
  "click",
  guard(async () => {
    const mode = importMode();
    const btn = $("#import-apply");
    btn.disabled = true;
    try {
      const r =
        imp.source === "defaults"
          ? await api("POST", "/api/rules/reset", { mode })
          : await api("POST", "/api/rules/import", { file: imp.file, mode });
      dialog.close();
      toast(
        mode === "merge"
          ? `Added ${r.added} rules${r.addedGroups ? ` and ${r.addedGroups} groups` : ""}`
          : `Replaced all rules: now ${r.total} rules in ${r.groups} groups`
      );
      await loadRules();
    } finally {
      btn.disabled = false;
    }
  })
);

// ---------- defaults banner ----------
export function renderDefaultsBanner() {
  const d = state.defaults;
  const el = $("#defaults-banner");
  if (!d || d.importedVersion >= d.version) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `<div class="banner info banner-actions">
    <div class="banner-text"><b>Updated default rules are available</b> (${esc(d.name)} v${d.version}, ${d.groups} groups, ${d.rules} rules${d.importedVersion ? `; yours are based on v${d.importedVersion}` : ""}).</div>
    <button class="btn sm primary" data-defaults>Review the update…</button>
  </div>`;
}
$("#defaults-banner").addEventListener("click", (e) => {
  if (e.target.closest("[data-defaults]")) openImport("defaults", "merge");
});
