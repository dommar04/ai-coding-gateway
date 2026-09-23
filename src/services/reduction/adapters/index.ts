import { estimateTokens } from "../tokens";
import { confirmationAdapter } from "./confirmation";
import { grepGlobAdapter } from "./grep-glob";
import { mcpAdapter } from "./mcp";
import { opaqueAdapter } from "./opaque";
import { readAdapter } from "./read";
import { shellAdapter } from "./shell";
import type { Adapter } from "./types";
import { webFetchAdapter } from "./web-fetch";

// One adapter per tool result shape. Add a file here to support a new tool.

export type { Adapter, TextField } from "./types";

export function adapterFor(toolName: string): Adapter {
  if (toolName === "Bash" || toolName === "PowerShell") return shellAdapter;
  if (toolName === "Read") return readAdapter;
  if (toolName === "Grep" || toolName === "Glob") return grepGlobAdapter;
  if (toolName === "WebFetch") return webFetchAdapter;
  if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(toolName)) return confirmationAdapter;
  if (toolName.startsWith("mcp__")) return mcpAdapter;
  return opaqueAdapter;
}

/** Tokens the agent spent writing the call (the tool input it generated). */
export function inputTokens(toolInput: unknown): number {
  return estimateTokens(JSON.stringify(toolInput ?? {}));
}
