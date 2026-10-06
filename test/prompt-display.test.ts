import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { displayPrompt } from "../src/integrations/codex/prompt-display";

test("Codex display removes recognized ambient wrapper and preserves original user content", () => {
  const user = "# Read this\n\n<button>example</button>\n";
  const raw = `<in-app-browser-context source="ambient-ui-state">\nBrowser metadata\n</in-app-browser-context>\n\n## My request:\n${user}`;
  assert.equal(displayPrompt(raw), user);
  assert.equal(displayPrompt(user), user);
  assert.equal(
    displayPrompt(`<unknown>context</unknown>\n## My request:\n${user}`),
    `<unknown>context</unknown>\n## My request:\n${user}`
  );
  assert.equal(
    displayPrompt("<in-app-browser-context>user example</in-app-browser-context>"),
    "<in-app-browser-context>user example</in-app-browser-context>"
  );
});

test("Markdown formats prompts and treats HTML and unsafe links as text", async () => {
  const source = readFileSync(join(__dirname, "../src/dashboard/public/js/markdown.js"), "utf8");
  const load = new Function("url", "return import(url)") as (url: string) => Promise<{ renderMarkdown(text: string): string }>;
  const { renderMarkdown } = await load(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  assert.match(
    renderMarkdown("# Heading\n\n- **First**\n- `second`\n\n```html\n<script>alert(1)</script>\n```"),
    /<h1>Heading<\/h1>/
  );
  assert.match(
    renderMarkdown("- **First**\n- `second`"),
    /<ul><li><strong>First<\/strong><\/li><li><code>second<\/code><\/li><\/ul>/
  );
  assert.match(renderMarkdown("```\n<a>\n```"), /<pre><code>&lt;a&gt;<\/code><\/pre>/);
  const unsafe = renderMarkdown('<img src=x onerror="alert(1)"> [click](javascript:alert)');
  assert.ok(!unsafe.includes("<img"));
  assert.ok(!unsafe.includes('href="javascript:'));
  assert.match(renderMarkdown('[docs](https://example.com/"onclick="evil)'), /&quot;/);
  assert.match(renderMarkdown("[docs](https://example.com)"), /rel="noopener noreferrer"/);
});
