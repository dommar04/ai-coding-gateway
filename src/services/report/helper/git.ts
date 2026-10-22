import { execFileSync } from "node:child_process";

// What a range of commits changed, read with git: the trace lines it adds, its diff, and file contents.
// Knows nothing about CI systems; ci.ts decides which commits to compare.

// Trace files anywhere in the repository (a project can be a subfolder), and the folders to leave out of the diff.
const TRACE_FILES = ":(glob)**/.goairside/traces/*.jsonl";
const TRACE_FOLDERS = ":(glob,exclude)**/.goairside/**";

/** The commits to compare: what `head` has that `base` doesn't. */
export interface Range {
  base: string;
  head: string;
  /** "..." compares against where head's branch started (merge requests), ".." against base itself (pushes). */
  dots: "..." | "..";
  /** What is compared, for people: "feature/login → main · #42". */
  label?: string;
}

export interface DiffLine {
  type: "add" | "del" | "context";
  text: string;
  /** Line number before the change (del and context lines). */
  oldLine?: number;
  /** Line number after the change (add and context lines). */
  newLine?: number;
}

export interface Hunk {
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface FileDiff {
  /** Path after the change, relative to the repository root. */
  path: string;
  /** Path before the change, when the file was renamed. */
  oldPath?: string;
  status: "added" | "modified" | "renamed";
  hunks: Hunk[];
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** The repository's top folder: paths in diffs and traces are relative to it. */
export function repoRoot(cwd: string): string {
  try {
    return git(["rev-parse", "--show-toplevel"], cwd).trim();
  } catch {
    throw new Error("Not inside a git repository (or git is not installed). The report needs git.");
  }
}

/** The default branch to compare a local run with: origin's default branch, else main or master. */
export function defaultBranch(cwd: string): string | null {
  try {
    return git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd).trim();
  } catch {
    // No remote, or its default branch is unknown.
  }
  for (const name of ["origin/main", "origin/master", "main", "master"]) {
    try {
      git(["rev-parse", "--verify", "--quiet", `${name}^{commit}`], cwd);
      return name;
    } catch {
      // Try the next name.
    }
  }
  return null;
}

/** Fails with a clear message when git or the needed history is missing (shallow clone, no .git). */
export function checkHistory(range: Range, cwd: string): void {
  for (const commit of [range.base, range.head]) {
    try {
      git(["cat-file", "-e", `${commit}^{commit}`], cwd);
    } catch {
      throw new Error(
        `Commit "${commit}" is not available. The report needs git and the full history ` +
          "(GitHub: actions/checkout with fetch-depth: 0; GitLab: GIT_DEPTH: 0)."
      );
    }
  }
}

/** The trace files the range adds or appends to (paths relative to the repository root). */
export function traceFiles(range: Range, cwd: string): string[] {
  return git(["diff", "--name-only", "--diff-filter=AM", spec(range), "--", TRACE_FILES], cwd)
    .split("\n")
    .filter(Boolean);
}

/**
 * A trace file as the range sees it: its session line and only the lines the range appended. A session
 * goes on in the same file across commits, and its earlier changes belong to earlier merge requests.
 */
export function traceInRange(range: Range, path: string, cwd: string): string {
  const session = fileAtHead(range, path, cwd).split("\n", 1)[0];
  const [diff] = parseDiff(git(["diff", "-U0", "--no-color", "--no-ext-diff", spec(range), "--", path], cwd));
  const added = diff?.hunks.flatMap((h) => h.lines.filter((l) => l.type === "add").map((l) => l.text)) ?? [];
  return [session, ...added.filter((l) => l !== session)].join("\n");
}

/** The diff with 3 lines of context, without the trace files. Deleted and binary files are left out. */
export function rangeDiff(range: Range, cwd: string): FileDiff[] {
  return parseDiff(git(["diff", "-U3", "--no-color", "--no-ext-diff", "-M", spec(range), "--", ".", TRACE_FOLDERS], cwd));
}

/** A file's content at the head commit. Not the working tree: CI often checks out a merge commit instead. */
export function fileAtHead(range: Range, path: string, cwd: string): string {
  return git(["show", `${range.head}:${path}`], cwd);
}

function spec(range: Range): string {
  return `${range.base}${range.dots}${range.head}`;
}

/** Parses `git diff` output (unified format). */
export function parseDiff(out: string): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | null = null;
  let deleted = false;
  let hunk: Hunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  const finish = () => {
    if (file && !deleted && file.path && file.hunks.length) files.push(file);
    file = null;
    hunk = null;
  };

  for (const line of out.split("\n")) {
    if (line.startsWith("diff --git ")) {
      finish();
      deleted = false;
      file = { path: "", status: "modified", hunks: [] };
      continue;
    }
    if (!file) continue;
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (h) {
      oldLine = Number(h[1]);
      newLine = Number(h[2]);
      hunk = { oldStart: oldLine, newStart: newLine, lines: [] };
      file.hunks.push(hunk);
    } else if (!hunk) {
      // File header.
      if (line.startsWith("new file mode")) file.status = "added";
      else if (line.startsWith("deleted file mode")) deleted = true;
      else if (line.startsWith("rename from ")) {
        file.oldPath = line.slice("rename from ".length);
        file.status = "renamed";
      } else if (line.startsWith("+++ ")) file.path = unquote(line.slice(4)).replace(/^b\//, "");
    } else if (line.startsWith("+")) {
      hunk.lines.push({ type: "add", text: line.slice(1), newLine: newLine++ });
    } else if (line.startsWith("-")) {
      hunk.lines.push({ type: "del", text: line.slice(1), oldLine: oldLine++ });
    } else if (line.startsWith(" ")) {
      hunk.lines.push({ type: "context", text: line.slice(1), oldLine: oldLine++, newLine: newLine++ });
    }
    // "\ No newline at end of file" carries no content.
  }
  finish();
  return files;
}

/** git quotes paths with unusual characters: "b/my \"file\".ts". */
function unquote(path: string): string {
  return path.startsWith('"') ? path.slice(1, -1).replace(/\\(.)/g, "$1") : path;
}
