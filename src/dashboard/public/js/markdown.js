// Small, dependency-free Markdown view. Raw HTML is always displayed as text.
const escape = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function inline(text) {
  const tokens = /`([^`]+)`|\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let html = "",
    end = 0;
  for (const match of text.matchAll(tokens)) {
    html += escape(text.slice(end, match.index));
    if (match[1] !== undefined) html += `<code>${escape(match[1])}</code>`;
    else if (match[2] !== undefined) {
      const url = match[3];
      html += /^https?:\/\//i.test(url)
        ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(match[2])}</a>`
        : escape(match[0]);
    } else if (match[4] !== undefined) html += `<strong>${escape(match[4])}</strong>`;
    else html += `<em>${escape(match[5])}</em>`;
    end = match.index + match[0].length;
  }
  return html + escape(text.slice(end));
}

/** Render common Markdown blocks without executing HTML or loading remote images. */
export function renderMarkdown(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [],
    list = [],
    listType = "";
  const flushParagraph = () => {
    if (paragraph.length) blocks.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push(`<${listType}>${list.map((item) => `<li>${inline(item)}</li>`).join("")}</${listType}>`);
    list = [];
    listType = "";
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*(`{3,}|~{3,})/.exec(line);
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const item = /^\s*(?:([-+*])|\d+\.)\s+(.+)$/.exec(line);
    if (fence) {
      flushParagraph();
      flushList();
      const code = [];
      const close = new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`);
      while (++i < lines.length && !close.test(lines[i])) code.push(lines[i]);
      blocks.push(`<pre><code>${escape(code.join("\n"))}</code></pre>`);
    } else if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (item) {
      flushParagraph();
      const type = item[1] ? "ul" : "ol";
      if (listType && listType !== type) flushList();
      listType = type;
      list.push(item[2]);
    } else if (!line.trim()) {
      flushParagraph();
      flushList();
    } else if (/^>\s?/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`);
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks.join("\n");
}
