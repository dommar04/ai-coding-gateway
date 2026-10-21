import { tokenizeWithPositions } from "../../trace/helper/hasher";
import type { TracedChange } from "./traces";

// Finds recorded AI content in a file. A token counts as AI when it is part of a recorded segment that
// appears in the file in the same order for at least MIN_RUN tokens, at a single place in the file.
// Shorter segments only count when the whole segment appears exactly once. Formatting does not matter
// (whitespace is not a token), and code a human changed breaks the run there.

/** Shortest run of tokens that counts as a match (8 tokens: about half a line of code). */
export const MIN_RUN = 8;

/** A highlighted piece of a line: AI content. Columns are character offsets in the line, end exclusive. */
export interface AiSpan {
  /** Line number, starting at 1. */
  line: number;
  start: number;
  end: number;
  change: TracedChange;
}

export interface FileMatch {
  spans: AiSpan[];
  /** Tokens on the lines the diff added. */
  addedTokens: number;
  /** Of those, the tokens matched as AI. */
  aiTokens: number;
  /** Recorded changes none of whose content was found in the file. */
  missing: TracedChange[];
}

/** Matches `changes` (all recorded for this file) against its content; only `addedLines` are highlighted. */
export function matchFile(content: string, addedLines: ReadonlySet<number>, changes: TracedChange[]): FileMatch {
  const tokens = tokenizeWithPositions(content);
  const hashes = tokens.map((t) => t.hash);
  const windows = windowIndex(hashes);

  // Which change each file token belongs to. Changes in time order: a later change of the same code wins.
  const owner: Array<TracedChange | undefined> = new Array(tokens.length);
  const missing: TracedChange[] = [];
  for (const change of [...changes].sort((a, b) => a.at.localeCompare(b.at))) {
    let found = false;
    for (const segment of change.segments) {
      for (const [from, length] of matches(segment, hashes, windows)) {
        found = true;
        for (let i = from; i < from + length; i++) owner[i] = change;
      }
    }
    if (!found) missing.push(change);
  }

  // Tokens on added lines, grouped into spans of neighbouring AI tokens of the same change.
  const lineStarts = [0];
  for (let i = 0; i < content.length; i++) if (content[i] === "\n") lineStarts.push(i + 1);
  const spans: AiSpan[] = [];
  let addedTokens = 0;
  let aiTokens = 0;
  let line = 1;
  tokens.forEach((token, i) => {
    while (line < lineStarts.length && lineStarts[line] <= token.start) line++;
    if (!addedLines.has(line)) return;
    addedTokens++;
    const change = owner[i];
    if (!change) return;
    aiTokens++;
    const start = token.start - lineStarts[line - 1];
    const end = token.end - lineStarts[line - 1];
    const last = spans[spans.length - 1];
    if (last && last.line === line && last.change === change && owner[i - 1] === change) last.end = end;
    else spans.push({ line, start, end, change });
  });

  return { spans, addedTokens, aiTokens, missing };
}

/** Where each MIN_RUN-token window of the file starts. */
function windowIndex(hashes: number[]): Map<string, number[]> {
  const index = new Map<string, number[]>();
  for (let i = 0; i + MIN_RUN <= hashes.length; i++) {
    const key = hashes.slice(i, i + MIN_RUN).join(",");
    const at = index.get(key);
    if (at) at.push(i);
    else index.set(key, [i]);
  }
  return index;
}

/** The places [file token index, length] where `segment` matches: unique windows, or the whole short segment. */
function matches(segment: number[], hashes: number[], windows: Map<string, number[]>): Array<[number, number]> {
  if (segment.length < MIN_RUN) {
    const at: number[] = [];
    for (let i = 0; i + segment.length <= hashes.length && at.length < 2; i++) {
      if (segment.every((h, k) => hashes[i + k] === h)) at.push(i);
    }
    return at.length === 1 ? [[at[0], segment.length]] : [];
  }
  const found: Array<[number, number]> = [];
  for (let i = 0; i + MIN_RUN <= segment.length; i++) {
    const at = windows.get(segment.slice(i, i + MIN_RUN).join(","));
    if (at?.length === 1) found.push([at[0], MIN_RUN]);
  }
  return found;
}
