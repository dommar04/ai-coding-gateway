// Token savings page: reduction options.
import { $, api, esc, guard, state, toast, token } from "./core.js";
import { fmtTok, strategyTitle } from "./format.js";

// ---------- token savings ----------
export async function loadStrategies() {
  const data = await api("GET", "/api/reduction");
  state.strategies = data.strategies;
  renderStrategies();
}

export function renderStrategies() {
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
      ${g.items
        .map(
          (s) => `
        <div class="strat" data-id="${esc(s.id)}">
          <div><div class="title">${esc(s.title)}</div><div class="desc">${esc(s.description)}</div></div>
          <div class="stat">${s.savedTokens ? `<div class="saved">saved ${fmtTok(s.savedTokens)}</div>` : ""}${s.calls ? `<div class="muted">${s.calls} call${s.calls === 1 ? "" : "s"}</div>` : '<div class="muted">no hits yet</div>'}</div>
          <div class="seg state">${s.states.map((st) => `<button data-state="${st}" class="${s.state === st ? "on" : ""}">${st === "on" ? "On" : "Off"}</button>`).join("")}</div>
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
