import type { FileDiff, DiffLine } from "../helper/git";
import type { AiSpan } from "../helper/matcher";
import type { TracedChange } from "../helper/traces";

// The report page: one self-contained HTML file (inline CSS, nothing loaded from elsewhere, opens offline).
// Shows the diff like a pull request, with the code an AI agent wrote highlighted.

export interface ReportFile extends FileDiff {
  spans: AiSpan[];
  addedTokens: number;
  aiTokens: number;
  /** Recorded changes no longer found in this file. */
  missing: number;
}

export interface ReportData {
  /** What was compared, e.g. "feature/login → main" or two commit ids. */
  subject: string;
  generatedAt: Date;
  files: ReportFile[];
  /** Number of agent sessions (trace files) in the range. */
  sessions: number;
  /** Recorded changes no longer found in the code, in all files. */
  missing: number;
  warnings: string[];
}

export function renderReport(data: ReportData): string {
  const added = sum(data.files, (f) => f.addedTokens);
  const ai = sum(data.files, (f) => f.aiTokens);
  const aiFiles = data.files.filter((f) => f.aiTokens > 0);
  const models = unique(data.files.flatMap((f) => f.spans.map((s) => s.change.model ?? "unknown model")));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>goAirside AI change report</title>
<style>${CSS}</style>
</head>
<body>
<header class="top">
  <div class="wrap"><div class="narrow top-row">
    <span class="logo"><span class="mark">//</span> goAirside</span>
    <span class="label">AI change report</span>
  </div></div>
</header>

<main class="wrap">
  <div class="narrow">
  <section class="hero">
    <p class="label dot">${esc(data.subject)}</p>
    <h1>${percent(ai, added)} of the new code<br>was written by AI.</h1>
    <p class="lead">${aiFiles.length} of ${data.files.length} changed files contain code from AI coding agents,
      recorded in ${data.sessions} agent session${data.sessions === 1 ? "" : "s"}.</p>
  </section>

  <section class="stats">
    ${stat("01", "AI share", percent(ai, added), `${fmt(ai)} of ${fmt(added)} new tokens`)}
    ${stat("02", "Files with AI code", `${aiFiles.length} / ${data.files.length}`, "changed files")}
    ${stat("03", "Models", String(models.length), models.map(esc).join(", ") || "none")}
    ${stat("04", "No longer present", String(data.missing), "recorded changes not found in the code")}
  </section>

  ${data.warnings.length ? `<section class="warnings">${data.warnings.map((w) => `<p>${esc(w)}</p>`).join("")}</section>` : ""}
  </div>

  <div class="layout">
    <aside class="sidebar">
      <p class="label section">01 / Files · ${data.files.length}</p>
      <ul class="files">
        ${data.files.map((f, i) => fileRow(f, i)).join("\n")}
      </ul>
    </aside>
    <div class="changes">
      <p class="label section">02 / Changes</p>
      ${data.files.map((f, i) => fileDiff(f, i)).join("\n")}
    </div>
  </div>
</main>

<footer class="wrap foot">
  <span class="label">Generated ${esc(time(data.generatedAt.toISOString()))}</span>
  <span class="legend"><span class="ai">AI</span> code written by an AI agent <span class="add-key">+</span> added <span class="del-key">−</span> removed</span>
</footer>
</body>
</html>
`;
}

function stat(n: string, label: string, value: string, note: string): string {
  return `<div class="stat"><div class="stat-head"><span class="label">${label}</span><span class="label">${n}</span></div>
    <div class="value">${esc(value)}</div><div class="note">${note}</div></div>`;
}

function fileRow(f: ReportFile, i: number): string {
  const share = f.addedTokens ? f.aiTokens / f.addedTokens : 0;
  const slash = f.path.lastIndexOf("/");
  return `<li><a href="#file-${i}" title="${esc(f.path)}">
    <span class="name">${esc(f.path.slice(slash + 1))}</span>
    <span class="dir">${esc(f.path.slice(0, slash + 1))}</span>
    <span class="bar"><span style="width:${(share * 100).toFixed(1)}%"></span></span>
    <span class="share">${f.aiTokens ? `${percent(f.aiTokens, f.addedTokens)} AI` : "—"}</span>
  </a></li>`;
}

function fileDiff(f: ReportFile, i: number): string {
  const spansByLine = new Map<number, AiSpan[]>();
  for (const s of f.spans) spansByLine.set(s.line, [...(spansByLine.get(s.line) ?? []), s]);
  const rename = f.oldPath ? `<span class="muted">${esc(f.oldPath)} →</span> ` : "";
  return `<article class="file" id="file-${i}">
  <div class="file-head">
    <span class="path">${rename}${esc(f.path)}</span>
    <span class="label">${f.status}${f.aiTokens ? ` · ${percent(f.aiTokens, f.addedTokens)} AI` : ""}${f.missing ? ` · ${f.missing} no longer present` : ""}</span>
  </div>
  ${f.hunks
    .map((h) => {
      const changes = unique(
        h.lines
          .flatMap((l) => (l.newLine !== undefined && l.type === "add" ? (spansByLine.get(l.newLine) ?? []) : []))
          .map((s) => s.change)
      );
      return `<div class="hunk-head">@@ -${h.oldStart} +${h.newStart} @@${changes.map((c) => `<span class="chip">${esc(describe(c))}</span>`).join("")}</div>
  <table class="diff">${h.lines.map((l) => row(l, spansByLine)).join("")}</table>`;
    })
    .join("\n")}
</article>`;
}

function row(l: DiffLine, spansByLine: Map<number, AiSpan[]>): string {
  const sign = l.type === "add" ? "+" : l.type === "del" ? "−" : "";
  const code = l.type === "add" && l.newLine !== undefined ? highlight(l.text, spansByLine.get(l.newLine) ?? []) : esc(l.text);
  return `<tr class="${l.type}"><td class="num">${l.oldLine ?? ""}</td><td class="num">${l.newLine ?? ""}</td><td class="sign">${sign}</td><td class="code">${code}</td></tr>`;
}

/** The line with its AI spans wrapped in <mark>. */
function highlight(text: string, spans: AiSpan[]): string {
  let out = "";
  let at = 0;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    out += esc(text.slice(at, s.start)) + `<mark title="${esc(describe(s.change))}">${esc(text.slice(s.start, s.end))}</mark>`;
    at = s.end;
  }
  return out + esc(text.slice(at));
}

function describe(c: TracedChange): string {
  return [c.model ?? "unknown model", c.tool, time(c.at)].join(" · ");
}

/** "21 Oct 2026, 11:14 UTC", the same everywhere (no locale). */
function time(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${month} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

function percent(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : "0%";
}

const fmt = (n: number) => n.toLocaleString("en");
const sum = <T>(items: T[], f: (item: T) => number) => items.reduce((n, item) => n + f(item), 0);
const unique = <T>(items: T[]) => [...new Set(items)];

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const CSS = `
:root {
  --ink: #111; --muted: #6b6b6b; --line: #e6e6e6; --soft: #f6f6f5; --bg: #fff;
  --add: #f3f3f1; --del: #fafafa; --ai: #dbe7ff; --ai-ink: #0b2a6b;
  --sans: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.6 var(--sans); }
.wrap { max-width: 1440px; margin: 0 auto; padding: 0 24px; }
/* Header, hero and stats: narrower than the files and code, on the same left edge. */
.narrow { max-width: 1120px; }
.label { font: 500 11px/1.4 var(--mono); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.dot::before { content: ""; display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--ink); margin-right: 8px; vertical-align: 1px; }
.muted { color: var(--muted); }

.top { border-bottom: 1px solid var(--line); }
.top-row { display: flex; align-items: center; justify-content: space-between; height: 52px; }
.logo { font-weight: 600; font-size: 17px; letter-spacing: -.01em; }
.mark { font-style: italic; font-weight: 800; margin-right: 2px; }

.hero { padding: 32px 0 24px; }
h1 { font-size: clamp(26px, 3.2vw, 36px); line-height: 1.12; letter-spacing: -.02em; font-weight: 500; margin: 10px 0 12px; }
.lead { color: #444; max-width: 620px; margin: 0; }

.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; padding-bottom: 32px; }
.stat { border-top: 1px solid var(--ink); padding-top: 10px; }
.stat-head { display: flex; justify-content: space-between; }
.value { font-size: 26px; font-weight: 500; letter-spacing: -.02em; margin: 4px 0 0; }
.note { color: var(--muted); font-size: 13px; }

.warnings { border: 1px solid var(--line); background: var(--soft); padding: 12px 16px; margin-bottom: 40px; font-size: 13px; }
.warnings p { margin: 0; }

section { margin-bottom: 56px; }
.section { border-bottom: 1px solid var(--line); padding-bottom: 12px; margin: 0 0 8px; }

.layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 40px; align-items: start; }
.sidebar { position: sticky; top: 0; max-height: 100vh; overflow-y: auto; padding: 16px 0 24px; }
.changes { padding-top: 16px; min-width: 0; }

.files { list-style: none; margin: 0; padding: 0; }
.files a { display: grid; grid-template-columns: 1fr auto; column-gap: 12px; row-gap: 6px; padding: 10px 8px;
  border-bottom: 1px solid var(--line); color: inherit; text-decoration: none; }
.files a:hover { background: var(--soft); }
.name { font: 500 13px/1.3 var(--mono); overflow-wrap: anywhere; }
.dir { grid-column: 1 / -1; grid-row: 2; font: 11px/1.3 var(--mono); color: var(--muted); overflow-wrap: anywhere; }
.dir:empty { display: none; }
.bar { grid-column: 1 / -1; height: 3px; background: var(--line); }
.bar span { display: block; height: 100%; background: var(--ink); }
.share { font: 11px var(--mono); color: var(--muted); white-space: nowrap; }
.path { font: 13px/1.4 var(--mono); overflow-wrap: anywhere; }

.file { border: 1px solid var(--line); margin: 0 0 24px; scroll-margin-top: 16px; }
.file:target { border-color: var(--ink); }
.file-head { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 12px 16px;
  background: var(--soft); border-bottom: 1px solid var(--line); }
.hunk-head { font: 12px var(--mono); color: var(--muted); padding: 8px 16px; border-bottom: 1px solid var(--line);
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.chip { background: var(--ai); color: var(--ai-ink); padding: 1px 8px; border-radius: 999px; font-size: 11px; }
.diff { width: 100%; border-collapse: collapse; font: 12.5px/1.6 var(--mono); display: block; overflow-x: auto; }
.diff tr:last-child td { padding-bottom: 6px; }
.num { width: 1%; min-width: 48px; padding: 0 10px; text-align: right; color: #aaa; user-select: none; vertical-align: top; }
.sign { width: 1%; padding: 0 6px; color: var(--muted); user-select: none; }
.code { white-space: pre; padding-right: 24px; width: 100%; }
tr.add { background: var(--add); }
tr.add .sign { color: var(--ink); }
tr.del { background: var(--del); }
tr.del .code { color: #9a9a9a; text-decoration: line-through; text-decoration-color: #c9c9c9; }
mark { background: var(--ai); color: var(--ai-ink); border-radius: 2px; padding: 1px 0; }

.foot { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 24px; border-top: 1px solid var(--line); }
.legend { font-size: 12px; color: var(--muted); display: flex; gap: 8px; align-items: center; }
.legend .ai { background: var(--ai); color: var(--ai-ink); padding: 0 6px; border-radius: 2px; font: 11px var(--mono); }
.add-key, .del-key { font-family: var(--mono); padding: 0 6px; background: var(--add); }

@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; gap: 0; }
  .sidebar { position: static; max-height: none; }
}
@media (max-width: 760px) {
  .stats { grid-template-columns: repeat(2, 1fr); }
  .hero { padding: 24px 0 20px; }
}
`;
