// Allow dialog: add an allow rule for a denied call, straight from its details.
import { $, $$, api, esc, guard, toast } from "./core.js";

const dialog = $("#allow-dialog");
let current = null; // { call, groups, onChange, onLeave }

/** Where the rule goes: the group for calls allowed from the activity, unless another is picked. */
function groupSelect(groups) {
  const approved = groups.find((g) => g.key === "approved");
  const options = groups
    .filter((g) => g !== approved)
    .map((g) => `<option value="${g.id}">${esc(g.title)}</option>`)
    .join("");
  return `<label class="allow-group">Add the rule to
    <select class="sm" data-group><option value="">${esc(approved ? approved.title : "The agent is allowed to make calls you allowed from the activity")}</option>${options}</select></label>`;
}

function render(call, o, groups) {
  const head = `<div class="allow-call mono">${esc(call.tool)}: ${esc(call.summary)}</div>`;
  if (o.state === "allowed") {
    return `${head}<div class="allow-meta">The current rules already allow this call, so there is nothing to add.</div>`;
  }
  if (o.state === "denied-by-rule") {
    const r = o.rule;
    return `${head}
      <div>Denied by deny rule #${r.id} <code>${esc(r.rule)}</code>${r.group ? ` · ${esc(r.group)}` : ""}${r.note ? ` · ${esc(r.note)}` : ""}</div>
      <div class="allow-meta">Deny rules always win over allow rules, so adding an allow rule would not change this. Switch the deny rule off to let calls like this through.</div>
      <div class="allow-row"><button class="btn sm ghost-danger" type="button" data-act="disable" data-rule="${r.id}">Switch off rule #${r.id}</button>
        <a href="#rules">Open the rules</a></div>`;
  }
  const rules = (list) => list.map((x) => `<code>${esc(x)}</code>`).join("<br>");
  return `${head}
    ${o.uncovered.length > 1 ? `<div class="allow-meta">Not covered: ${o.uncovered.map((u) => `<code class="chip">${esc(u)}</code>`).join(" ")}</div>` : ""}
    <div class="choices">
      <div class="choice"><div class="t">Exact</div><div>${rules(o.exact)}</div>
        <div><button class="btn sm" type="button" data-act="exact">Allow exact</button></div></div>
      <div class="choice rec"><div class="t">Broad · recommended</div><div>${rules(o.broad)}</div>
        <div><button class="btn sm primary" type="button" data-act="broad">Allow broad</button></div></div>
    </div>
    <div class="allow-row">${groupSelect(groups)}<span class="grow"></span>
      <button class="btn sm" type="button" data-act="custom-toggle">Custom rule…</button></div>
    <div class="allow-custom" hidden>
      <textarea class="mono" aria-label="Allow rules, one per line">${esc(o.broad.join("\n"))}</textarea>
      <div class="allow-row"><span class="grow"></span><button class="btn sm primary" type="button" data-act="custom">Allow with these rules</button></div>
    </div>`;
}

/** Opens the dialog for a call. onChange runs after a rule changed, onLeave when a link leaves the page. */
export async function openAllowDialog(call, { onChange = () => {}, onLeave = () => {} } = {}) {
  const [options, groups] = await Promise.all([api("GET", `/api/calls/${call.id}/allow`), api("GET", "/api/rule-groups")]);
  current = { call, onChange, onLeave };
  $("#allow-body").innerHTML = render(call, options, groups);
  dialog.showModal();
}

$("#allow-body").addEventListener(
  "click",
  guard(async (e) => {
    if (!current) return;
    if (e.target.closest("a")) {
      dialog.close();
      current.onLeave();
      return;
    }
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "custom-toggle") {
      const box = $("#allow-body .allow-custom");
      box.hidden = !box.hidden;
      return;
    }
    if (act === "disable") {
      await api("PATCH", `/api/rules/${btn.dataset.rule}`, { enabled: false });
      toast(`Rule #${btn.dataset.rule} switched off`);
    } else {
      const body = { mode: act };
      if (act === "custom") body.rule = $("#allow-body textarea").value;
      const group = $("#allow-body [data-group]").value;
      if (group) body.groupId = Number(group);
      const r = await api("POST", `/api/calls/${current.call.id}/allow`, body);
      toast(`Allowed: ${r.rules.join(", ")}`);
    }
    dialog.close();
    current.onChange();
  })
);
$$("#allow-dialog [data-close]").forEach((b) => b.addEventListener("click", () => dialog.close()));
