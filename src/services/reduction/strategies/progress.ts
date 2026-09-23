import { isShell, type OutputStrategy } from "./shared";

const SPINNER_LINE = /^\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏|/\\-]?\s*(\[?[#=>\-.\s█▓▒░]{8,}\]?)?\s*\d{1,3}(\.\d+)?%.*$/;

export const progress: OutputStrategy = {
  id: "progress",
  title: "Remove progress bars",
  description: "Keeps only the final state of lines redrawn with carriage returns, and drops spinner and percentage-only lines.",
  group: "Lossless cleanup",
  defaultState: "on",
  applies: isShell,
  apply: (text) =>
    text
      .split("\n")
      .map((line) => {
        const cr = line.replace(/\r$/, "").lastIndexOf("\r");
        return cr >= 0 ? line.slice(cr + 1) : line;
      })
      .filter((line) => !SPINNER_LINE.test(line))
      .join("\n"),
};
