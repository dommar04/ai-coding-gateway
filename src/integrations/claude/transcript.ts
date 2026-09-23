import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";

// Reads Claude Code session transcripts (JSONL) to find, per prompt:
//  - the text the user wrote (user entries carry a promptId)
//  - the real API token usage of all model requests answering it (assistant entries carry
//    message.usage; they follow the prompt until the next prompt)
// Files are read incrementally and cached, since transcripts grow to many megabytes.

export interface PromptUsage {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  requests: number;
}

export interface PromptInfo {
  promptId: string;
  text: string | null;
  at: string | null;
  usage: PromptUsage;
}

interface CacheEntry {
  offset: number;
  current: string | null;
  seenMessages: Set<string>;
  prompts: Map<string, PromptInfo>;
}

const cache = new Map<string, CacheEntry>();

const emptyUsage = (): PromptUsage => ({ inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, requests: 0 });

/** User text without the harness' injected blocks (system reminders, command caveats, ...). */
export function cleanPromptText(text: string): string {
  if (/^\s*<task-notification>/.test(text)) return "⚙ Background task finished (automatic message)";
  return text
    .replace(
      /<(system-reminder|local-command-caveat|local-command-stdout|command-message|command-args|command-name)>[\s\S]*?<\/\1>/g,
      ""
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 4000);
}

function userText(content: unknown): string | null {
  if (typeof content === "string") return cleanPromptText(content) || null;
  if (!Array.isArray(content)) return null;
  if (content.some((b) => b && typeof b === "object" && (b as { type?: string }).type === "tool_result")) return null;
  const text = content
    .filter((b) => b && typeof b === "object" && (b as { type?: string }).type === "text")
    .map((b) => (b as { text?: string }).text ?? "")
    .join("\n");
  return cleanPromptText(text) || null;
}

function ingest(entry: CacheEntry, line: string): void {
  let o: {
    type?: string;
    promptId?: string;
    timestamp?: string;
    uuid?: string;
    message?: { id?: string; content?: unknown; usage?: Record<string, number> };
  };
  try {
    o = JSON.parse(line);
  } catch {
    return;
  }
  if (o.type === "user" && typeof o.promptId === "string") {
    entry.current = o.promptId;
    let p = entry.prompts.get(o.promptId);
    if (!p) {
      p = { promptId: o.promptId, text: null, at: o.timestamp ?? null, usage: emptyUsage() };
      entry.prompts.set(o.promptId, p);
    }
    if (!p.text) {
      const text = userText(o.message?.content);
      if (text) {
        p.text = text;
        p.at = o.timestamp ?? p.at;
      }
    }
    return;
  }
  if (o.type === "assistant" && entry.current && o.message?.usage) {
    // One API response is split over several lines (one per content block), all with the same usage.
    const id = o.message.id ?? o.uuid;
    if (id) {
      if (entry.seenMessages.has(id)) return;
      entry.seenMessages.add(id);
    }
    const u = o.message.usage;
    const p = entry.prompts.get(entry.current);
    if (!p) return;
    p.usage.inputTokens += u.input_tokens ?? 0;
    p.usage.cacheReadTokens += u.cache_read_input_tokens ?? 0;
    p.usage.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
    p.usage.outputTokens += u.output_tokens ?? 0;
    p.usage.requests += 1;
  }
}

/** All prompts found in a transcript so far (cached; only new bytes are read on each call). */
export function readTranscript(path: string): Map<string, PromptInfo> {
  if (!path || !existsSync(path)) return new Map();
  let entry = cache.get(path);
  const size = statSync(path).size;
  if (!entry || size < entry.offset) {
    entry = { offset: 0, current: null, seenMessages: new Set(), prompts: new Map() };
    cache.set(path, entry);
  }
  if (size > entry.offset) {
    const fd = openSync(path, "r");
    try {
      const chunk = Buffer.alloc(Math.min(size - entry.offset, 64 * 1024 * 1024));
      const read = readSync(fd, chunk, 0, chunk.length, entry.offset);
      // Only consume complete lines; a partial last line (or a split UTF-8 char) is re-read next time.
      const lastNewline = chunk.subarray(0, read).lastIndexOf(0x0a);
      if (lastNewline >= 0) {
        entry.offset += lastNewline + 1;
        for (const line of chunk.subarray(0, lastNewline).toString("utf8").split("\n")) if (line.trim()) ingest(entry, line);
      }
    } finally {
      closeSync(fd);
    }
  }
  return entry.prompts;
}

export function promptInfo(transcriptPath: string | null, promptId: string): PromptInfo | null {
  if (!transcriptPath) return null;
  try {
    return readTranscript(transcriptPath).get(promptId) ?? null;
  } catch {
    return null;
  }
}
