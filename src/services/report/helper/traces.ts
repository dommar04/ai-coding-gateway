import { posix } from "node:path";
import { TOKENIZER_VERSION, TRACE_FORMAT_VERSION } from "../../trace/helper/trace-file";
import { decodeSegment } from "../../trace/helper/hasher";

// Reads trace files (docs/trace-format.md). Lines of unknown kinds and broken lines are skipped;
// files with a format or tokenizer version this reader doesn't know are skipped with a warning.

export interface TracedChange {
  /** File path relative to the repository root. */
  path: string;
  tool: string;
  model?: string;
  /** ISO time of the change. */
  at: string;
  agent: string;
  session: string;
  /** Token hashes of each added segment. */
  segments: number[][];
}

export interface TraceRead {
  changes: TracedChange[];
  warnings: string[];
}

/**
 * The changes in one trace file. `file` is its path in the repository (…/.goairside/traces/x.jsonl):
 * paths inside the trace are relative to the folder holding .goairside.
 */
export function readTrace(file: string, text: string): TraceRead {
  const project = posix.dirname(posix.dirname(posix.dirname(file)));
  const lines = text.split("\n").filter((l) => l.trim());
  const session = parse(lines[0]);
  if (session?.kind !== "session" || session.format !== "goairside-trace") {
    return { changes: [], warnings: [`${file}: not a goairside trace file, skipped.`] };
  }
  if (session.v !== TRACE_FORMAT_VERSION || session.tokenizer !== TOKENIZER_VERSION) {
    return {
      changes: [],
      warnings: [`${file}: format ${session.v} / tokenizer ${session.tokenizer} is not supported by this version, skipped.`],
    };
  }

  const changes: TracedChange[] = [];
  for (const line of lines.slice(1)) {
    const o = parse(line);
    if (o?.kind !== "change" || typeof o.path !== "string" || !Array.isArray(o.seg)) continue;
    const segments = o.seg.filter((s): s is string => typeof s === "string").map(decodeSegment);
    changes.push({
      path: project === "." ? o.path : posix.join(project, o.path),
      tool: String(o.tool ?? ""),
      model: typeof o.model === "string" ? o.model : undefined,
      at: String(o.t ?? ""),
      agent: String(session.agent ?? ""),
      session: String(session.session ?? ""),
      segments: segments.filter((s) => s.length),
    });
  }
  return { changes, warnings: [] };
}

function parse(line: string | undefined): Record<string, unknown> | null {
  if (!line) return null;
  try {
    const o = JSON.parse(line);
    return o && typeof o === "object" ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
