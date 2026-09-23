import { estimateTokens } from "../tokens";

// Claude Code accepts a replaced tool result only in the tool's own shape (verified: Bash needs
// {stdout, stderr, ...}, Read needs {type, file: {content, ...}}). An adapter exposes the text parts
// of one tool's result so strategies can work on plain strings, and puts them back in the same shape.

export interface TextField {
  /** Stable name used in stats and spill file names, e.g. "stdout", "content", "block2". */
  name: string;
  text: string;
}

export interface Adapter {
  /** The text fields strategies may rewrite. */
  fields(response: unknown): TextField[];
  /** A copy of `response` with the given fields replaced. */
  withFields(response: unknown, fields: TextField[]): unknown;
  /** Estimated tokens of what the agent actually sees for this result. */
  visibleTokens(response: unknown): number;
}

export type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
export const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Adapter for results that are an object with top-level string fields. */
export function objectFields(keys: string[]): Adapter {
  return {
    fields: (r) =>
      isObj(r) ? keys.filter((k) => typeof r[k] === "string" && r[k]).map((k) => ({ name: k, text: r[k] as string })) : [],
    withFields: (r, fields) => {
      if (!isObj(r)) return r;
      const copy: Obj = { ...r };
      for (const f of fields) copy[f.name] = f.text;
      return copy;
    },
    visibleTokens: (r) => (isObj(r) ? keys.reduce((n, k) => n + estimateTokens(str(r[k])), 0) : 0),
  };
}
