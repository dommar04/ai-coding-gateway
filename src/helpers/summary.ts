/** One-line description of a tool call's input (command, path, pattern or URL), used by the CLI and dashboard. */
export function summarizeInput(toolInputJson: string | null): string {
  if (!toolInputJson) return "";
  try {
    const input = JSON.parse(toolInputJson) as Record<string, unknown>;
    if (input === null || typeof input !== "object") return String(input);
    if (typeof input.command === "string") return input.command;
    if (typeof input.file_path === "string") return input.file_path;
    if (typeof input.notebook_path === "string") return input.notebook_path;
    if (typeof input.pattern === "string") return input.pattern;
    if (typeof input.url === "string") return input.url;
    if (typeof input.query === "string") return input.query;
    if (typeof input.description === "string") return input.description;
    return JSON.stringify(input);
  } catch {
    return toolInputJson;
  }
}
