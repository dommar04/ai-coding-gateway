import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { packageVersion } from "../../../integrations/shared/settings";

// One trace file per agent session in <project>/.goairside/traces (format: docs/trace-format.md).
// Every hook call is its own process, so the file is found again by the session id in its name.

export const TRACE_FORMAT_VERSION = 1;
export const TOKENIZER_VERSION = 1;

export interface TraceSession {
  id: string;
  agent: string;
  agentVersion?: string;
}

export interface TraceChange {
  tool: string;
  /** Absolute path, or relative to the project root. */
  path: string;
  /** Encoded segments of the added content. */
  seg: string[];
  model?: string;
  at?: Date;
}

export class TraceFile {
  readonly dir: string;

  constructor(
    private readonly projectRoot: string,
    private readonly session: TraceSession
  ) {
    this.dir = join(projectRoot, ".goairside", "traces");
  }

  /** Appends a change line, creating the file with its session line first. False when nothing was written. */
  addChange(change: TraceChange): boolean {
    const path = this.relativePath(change.path);
    if (path === null || !change.seg.length) return false;
    const at = change.at ?? new Date();
    const file = this.existingFile() ?? this.create(at);
    appendFileSync(
      file,
      JSON.stringify({
        kind: "change",
        t: at.toISOString(),
        ...(change.model ? { model: change.model } : {}),
        tool: change.tool,
        path,
        seg: change.seg,
      }) + "\n"
    );
    return true;
  }

  /** The session's file, if it exists already. */
  existingFile(): string | null {
    const suffix = `_${this.session.id.slice(0, 8)}.jsonl`;
    try {
      const name = readdirSync(this.dir).find((f) => f.endsWith(suffix));
      return name ? join(this.dir, name) : null;
    } catch {
      return null;
    }
  }

  /** Path relative to the project root with "/" separators; null for files outside the project. */
  relativePath(path: string): string | null {
    const rel = relative(this.projectRoot, isAbsolute(path) ? path : join(this.projectRoot, path));
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
    return rel.split("\\").join("/");
  }

  private create(at: Date): string {
    mkdirSync(this.dir, { recursive: true });
    const stamp = at.toISOString().slice(0, 19).replace(/:/g, "-") + "Z";
    const file = join(this.dir, `${stamp}_${this.session.id.slice(0, 8)}.jsonl`);
    const header = {
      kind: "session",
      format: "goairside-trace",
      v: TRACE_FORMAT_VERSION,
      tokenizer: TOKENIZER_VERSION,
      session: this.session.id,
      agent: this.session.agent,
      ...(this.session.agentVersion ? { agentVersion: this.session.agentVersion } : {}),
      gateway: packageVersion(),
      started: at.toISOString(),
    };
    try {
      // "wx": if a parallel tool call of the same session created the file first, keep its session line.
      writeFileSync(file, JSON.stringify(header) + "\n", { flag: "wx" });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    return file;
  }
}
