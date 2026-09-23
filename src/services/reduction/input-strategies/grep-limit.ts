import type { InputStrategy } from "./types";

export const GREP_LIMIT = 250;

export const grepLimit: InputStrategy = {
  id: "grep-limit",
  title: `Limit Grep content results to ${GREP_LIMIT}`,
  description: `Grep in content mode without head_limit gets head_limit ${GREP_LIMIT}. Claude is told results were limited.`,
  group: "Before the call runs",
  defaultState: "off",
  applies: (t) => t === "Grep",
  rewrite: (input) => {
    if (input.output_mode !== "content" || input.head_limit !== undefined) return null;
    return {
      input: { ...input, head_limit: GREP_LIMIT },
      note: `The apichap gateway limited these Grep results to ${GREP_LIMIT} lines. Narrow the pattern or use head_limit/offset to see more.`,
    };
  },
};
