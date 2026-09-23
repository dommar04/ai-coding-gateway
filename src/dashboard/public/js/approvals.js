// Approvals page.
import { $, $$, api, esc, guard, managed, state, toast } from "./core.js";
import { baseName, fmtTime } from "./format.js";

// ---------- approvals ----------
export async function loadRequests() {
  state.requests = await api("GET", `/api/requests?status=${state.reqStatus}`);
  renderRequests();
}

$$("#req-filter button").forEach((b) =>
  b.addEventListener(
    "click",
    guard(async () => {
      state.reqStatus = b.dataset.status;
      $$("#req-filter button").forEach((x) => x.classList.toggle("on", x === b));
      await loadRequests();
    })
  )
);

export function renderRequests() {
  const el = $("#requests");
  if (!state.requests.length) {
    el.innerHTML = `<div class="empty"><svg class="icon"><use href="#i-check"/></svg><div>${state.reqStatus === "pending" ? "All caught up. No pending approval requests." : "No approval requests yet."}</div></div>`;
    return;
  }
  const ro = managed();
  const rules = (list) => list.map((x) => `<code>${esc(x)}</code>`).join("<br>");
  el.innerHTML = state.requests
    .map((r) => {
      const pending = r.status === "pending";
      const status = pending
        ? ""
        : `<span class="badge b-${esc(r.status)}">${esc(r.status)}</span><span class="req-meta">by ${esc(r.decidedBy)} · ${esc(fmtTime(r.decidedAt))}</span>`;
      const partial = r.uncovered.length > 1 || (r.subject && r.uncovered[0] !== r.subject);
      return `<div class="req" data-id="${r.id}">
      <div class="req-top"><strong>#${r.id} · ${esc(r.tool)}</strong>
        <span class="req-meta">${r.hitCount}× · last ${esc(fmtTime(r.lastSeen))} · ${esc(baseName(r.project))}</span>${status}</div>
      ${r.subject ? `<div class="call mono">${esc(r.subject)}</div>` : ""}
      ${partial ? `<div class="req-meta">Not covered: ${r.uncovered.map((u) => `<code class="chip">${esc(u)}</code>`).join(" ")}</div>` : ""}
      ${
        pending && !ro
          ? `
      <div class="choices">
        <div class="choice"><div class="t">Exact</div><div>${rules(r.suggestedExact)}</div>
          <div><button class="btn sm" data-act="exact">Approve exact</button></div></div>
        <div class="choice rec"><div class="t">Broad · recommended</div><div>${rules(r.suggestedBroad)}</div>
          <div><button class="btn sm primary" data-act="broad">Approve broad</button></div></div>
      </div>
      <div class="row">
        <button class="btn sm" data-act="custom-toggle">Custom rule…</button>
        <span class="grow"></span>
        <button class="btn sm ghost-danger" data-act="reject">Reject</button>
      </div>
      <div class="row custom" hidden>
        <textarea class="mono">${esc(r.suggestedBroad.join("\n"))}</textarea>
        <button class="btn sm primary" data-act="custom">Approve with these rules</button>
      </div>`
          : pending
            ? '<div class="req-meta">Waiting for an admin to decide.</div>'
            : ""
      }
    </div>`;
    })
    .join("");
}

$("#requests").addEventListener(
  "click",
  guard(async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const card = btn.closest(".req");
    const id = card.dataset.id;
    const act = btn.dataset.act;
    if (act === "custom-toggle") {
      card.querySelector(".custom").hidden = !card.querySelector(".custom").hidden;
      return;
    }
    btn.disabled = true;
    try {
      if (act === "reject") {
        await api("POST", `/api/requests/${id}/reject`);
        toast(`Request #${id} rejected`);
      } else {
        const body = act === "custom" ? { mode: "custom", rule: card.querySelector("textarea").value } : { mode: act };
        const r = await api("POST", `/api/requests/${id}/approve`, body);
        toast(
          `Added ${r.rules.join(", ")}` +
            (r.autoClosed.length ? ` · also closed ${r.autoClosed.map((x) => "#" + x).join(", ")}` : "")
        );
      }
      await loadRequests();
    } finally {
      btn.disabled = false;
    }
  })
);
