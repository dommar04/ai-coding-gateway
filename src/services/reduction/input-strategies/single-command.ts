import { splitCommand } from "../../tool-security/matching/shell";

/** Only simple, single commands are rewritten; chains are left alone. */
export function singleCommand(input: Record<string, unknown>, shell: "bash" | "powershell"): string | null {
  if (typeof input.command !== "string") return null;
  const parts = splitCommand(input.command, shell);
  return parts.length === 1 ? input.command.trim() : null;
}
