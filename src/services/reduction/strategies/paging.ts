import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { notRead, NOTE, type OutputStrategy } from "./shared";

export const PAGING = { maxLines: 400, maxChars: 20_000, headLines: 150, tailLines: 50, keepDays: 3 };

function cleanSpillDir(dir: string): void {
  try {
    const cutoff = Date.now() - PAGING.keepDays * 86_400_000;
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      if (statSync(file).mtimeMs < cutoff) unlinkSync(file);
    }
  } catch {
    // best effort
  }
}

export const paging: OutputStrategy = {
  id: "paging",
  title: "Page long output",
  description: `Output over ${PAGING.maxLines} lines or ${PAGING.maxChars.toLocaleString("en")} characters is cut to the first ${PAGING.headLines} and last ${PAGING.tailLines} lines. The full output is saved to a file Claude can page through with Read.`,
  group: "Long output",
  defaultState: "on",
  applies: notRead,
  apply: (text, ctx) => {
    const lines = text.split("\n");
    if (lines.length <= PAGING.maxLines && text.length <= PAGING.maxChars) return text;

    const safeId = ctx.toolUseId.replace(/[^\w-]/g, "_");
    const file = join(ctx.spillDir, `${safeId}-${ctx.field}.txt`);
    if (!ctx.dryRun) {
      mkdirSync(ctx.spillDir, { recursive: true });
      writeFileSync(file, text);
      cleanSpillDir(ctx.spillDir);
    }

    let head: string[];
    let tail: string[];
    if (lines.length > PAGING.headLines + PAGING.tailLines) {
      head = lines.slice(0, PAGING.headLines);
      tail = lines.slice(-PAGING.tailLines);
    } else {
      // Few but very long lines: cut by characters instead.
      head = [text.slice(0, Math.floor(PAGING.maxChars * 0.75))];
      tail = [text.slice(-Math.floor(PAGING.maxChars * 0.2))];
    }
    const size = `${lines.length.toLocaleString("en")} lines, ${Math.round(text.length / 1024).toLocaleString("en")} KB`;
    return [
      ...head,
      "",
      `${NOTE} Output shortened (${size}). Showing the first and last part. Full output: ${file}`,
      `${NOTE} Read more with the Read tool (offset/limit) or search it with Grep.`,
      "",
      ...tail,
    ].join("\n");
  },
};
