import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { InputStrategy } from "./types";

export const READ_LIMIT = 1000;

function countLines(path: string): number {
  try {
    if (!existsSync(path) || statSync(path).size < 40_000) return 0; // small files: not worth checking
    const text = readFileSync(path, "utf8");
    let n = 1;
    for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) n++;
    return n;
  } catch {
    return 0;
  }
}

export const readLimit: InputStrategy = {
  id: "read-limit",
  title: `Limit big file reads to ${READ_LIMIT.toLocaleString("en")} lines`,
  description: `A Read of a file with more than ${READ_LIMIT.toLocaleString("en")} lines and no limit gets limit ${READ_LIMIT}. Claude is told how many lines exist and pages with offset/limit.`,
  group: "Before the call runs",
  defaultState: "off",
  applies: (t) => t === "Read",
  rewrite: (input, cwd) => {
    if (input.limit !== undefined || input.offset !== undefined || typeof input.file_path !== "string") return null;
    const total = countLines(resolve(cwd, input.file_path));
    if (total <= READ_LIMIT) return null;
    return {
      input: { ...input, limit: READ_LIMIT },
      note: `The apichap gateway limited this Read to lines 1–${READ_LIMIT} of ${total.toLocaleString("en")}. Use offset/limit to read further.`,
    };
  },
};
