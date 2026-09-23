import { isShell, isMcp, NOTE, type OutputStrategy } from "./shared";

const LONG_LINE = 2000;

export const longLines: OutputStrategy = {
  id: "long-lines",
  title: "Shorten very long lines",
  description: `Cuts single lines over ${LONG_LINE.toLocaleString("en")} characters (minified code, base64, data blobs) to their first 300 characters.`,
  group: "Condense noisy output",
  defaultState: "on",
  applies: (t) => isShell(t) || t === "Grep" || isMcp(t),
  apply: (text) =>
    text
      .split("\n")
      .map((line) =>
        line.length > LONG_LINE
          ? `${line.slice(0, 300)} ⋯ ${NOTE} line shortened, ${line.length.toLocaleString("en")} chars`
          : line
      )
      .join("\n"),
};
