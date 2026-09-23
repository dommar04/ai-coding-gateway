import { isShell, isMcp, type OutputStrategy } from "./shared";

export const jsonCompact: OutputStrategy = {
  id: "json-compact",
  title: "Compact JSON",
  description: "Re-serializes pretty-printed JSON output without indentation. Same data, fewer tokens.",
  group: "Lossless cleanup",
  defaultState: "on",
  applies: (t, field) => (isShell(t) && field === "stdout") || isMcp(t),
  apply: (text) => {
    const trimmed = text.trim();
    if (trimmed.length < 200 || !/^[[{]/.test(trimmed) || !/\n\s+/.test(trimmed)) return text;
    try {
      return JSON.stringify(JSON.parse(trimmed));
    } catch {
      return text;
    }
  },
};
