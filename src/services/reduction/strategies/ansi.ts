import { notRead, type OutputStrategy } from "./shared";

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]/g;

export const ansi: OutputStrategy = {
  id: "ansi",
  title: "Strip color codes",
  description: "Removes terminal color and cursor escape codes. Claude can't see colors anyway.",
  group: "Lossless cleanup",
  defaultState: "on",
  applies: notRead,
  apply: (text) => text.replace(ANSI, ""),
};
