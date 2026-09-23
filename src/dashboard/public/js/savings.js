// Token savings page: reduction options and totals.
import { $, api, esc, guard, managed, state, toast, token } from "./core.js";
import { fmtTok, pct, strategyTitle } from "./format.js";

// ---------- token savings ----------
export function renderSavingsTotals(t) {
  $("#s-tokens").textContent = fmtTok(t.resultTokens);
  $("#s-calls").textContent = `in ${Number(t.calls || 0).toLocaleString()} tool calls`;
  $("#s-saved").textContent = fmtTok(t.savedTokens);
  $("#s-saved-sub").textContent = `${pct(t.savedTokens, t.resultTokens)}% of tool result tokens`;
  $("#s-potential").textContent = fmtTok(t.potentialTokens);
  $("#s-input").textContent = fmtTok(t.inputTokens);
}

export async function loadStrategies() {
  const data = await api("GET", "/api/reduction");
  state.strategies = data.strategies;
  renderSavingsTotals(data.totals);
  renderStrategies();
}

export function renderStrategies() {
  const ro = managed();
  const groups = [];
  for (const s of state.strategies) {
    let g = groups.find((x) => x.name === s.group);
    if (!g) groups.push((g = { name: s.group, items: [] }));
    g.items.push(s);
  }
  $("#strategies").innerHTML = groups
    .map(
      (g) => `
    <div class="card">
      <div class="card-head"><h2>${esc(g.name)}</h2></div>
      ${g.name === "Before the call runs" ? '<div class="note-warn">These change the tool call itself before it runs. Only rewrites that make output smaller; check that Claude Code still asks you for permission where it normally would.</div>' : ""}
      ${g.items
        .map(
          (s) => `
        <div class="strat" data-id="${esc(s.id)}">
          <div><div class="title">${esc(s.title)}</div><div class="desc">${esc(s.description)}</div></div>
          <div class="stat">${s.savedTokens ? `<div class="saved">saved ${fmtTok(s.savedTokens)}</div>` : ""}${s.measuredTokens ? `<div class="measured">would save ${fmtTok(s.measuredTokens)}</div>` : ""}${s.calls ? `<div class="muted">${s.calls} call${s.calls === 1 ? "" : "s"}</div>` : '<div class="muted">no hits yet</div>'}</div>
          <div class="seg state">${s.states.map((st) => `<button data-state="${st}" class="${s.state === st ? "on" : ""}" ${ro ? "disabled" : ""}>${st === "on" ? "On" : st === "measure" ? "Measure" : "Off"}</button>`).join("")}</div>
        </div>`
        )
        .join("")}
    </div>`
    )
    .join("");
}

$("#strategies").addEventListener(
  "click",
  guard(async (e) => {
    const btn = e.target.closest(".seg.state button");
    if (!btn || btn.classList.contains("on")) return;
    const id = btn.closest(".strat").dataset.id;
    await api("PUT", `/api/reduction/${encodeURIComponent(id)}`, { state: btn.dataset.state });
    state.strategies.find((s) => s.id === id).state = btn.dataset.state;
    renderStrategies();
    toast(`${strategyTitle(id)}: ${btn.textContent}`);
  })
);
