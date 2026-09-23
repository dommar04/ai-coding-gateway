import { notRead, type OutputStrategy } from "./shared";

export const blankLines: OutputStrategy = {
  id: "blank-lines",
  title: "Collapse blank lines",
  description: "Trims trailing spaces and collapses runs of empty lines into one.",
  group: "Lossless cleanup",
  defaultState: "on",
  applies: notRead,
  apply: (text) => text.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n"),
};
