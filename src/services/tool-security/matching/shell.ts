// Splits a shell command into the individual cli it runs, so that
// `git status && rm -rf ~` is judged as two cli, not one "git ..." command.
// Splits on && || ; | & and newlines (respecting quotes) and also extracts the
// cli inside $(...), <(...), >(...) and bash backticks. Heredoc bodies (<<EOF ... EOF)
// are data, not cli; only $(...) inside an unquoted heredoc is extracted, since bash runs it.

export type Shell = "bash" | "powershell";

export function normalizeCommand(cmd: string): string {
  return cmd.trim().replace(/\s+/g, " ");
}

/**
 * The command with heredoc bodies removed (the operator line stays). Bodies are data such as file
 * content or commit messages; deny rules that scan the whole command must not match text in them.
 * Also finds heredocs inside "$(...)", e.g. git commit -m "$(cat <<'EOF' ... EOF)".
 */
export function stripHeredocBodies(cmd: string, shell: Shell): string {
  if (shell !== "bash" || !cmd.includes("<<")) return cmd;
  type Ctx = { kind: "code"; depth: number } | { kind: "dq" };
  const stack: Ctx[] = [{ kind: "code", depth: 0 }];
  let pending: Heredoc[] = [];
  let out = "";
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    const ctx = stack[stack.length - 1];
    if (c === "\\" && i + 1 < cmd.length) {
      out += c + cmd[++i];
      continue;
    }
    if (c === "\n" && pending.length) {
      out += "\n";
      i = skipHeredocBodies(cmd, i + 1, pending).next - 1;
      pending = [];
      continue;
    }
    if (ctx.kind === "dq") {
      if (c === '"') stack.pop();
      else if (c === "$" && cmd[i + 1] === "(") {
        stack.push({ kind: "code", depth: 1 });
        out += "$(";
        i++;
        continue;
      }
      out += c;
      continue;
    }
    if (c === "'") {
      const close = cmd.indexOf("'", i + 1);
      const end = close === -1 ? cmd.length : close + 1;
      out += cmd.slice(i, end);
      i = end - 1;
      continue;
    }
    if (c === '"') stack.push({ kind: "dq" });
    else if (c === "(") ctx.depth++;
    else if (c === ")" && stack.length > 1 && --ctx.depth === 0) stack.pop();
    else if (c === "<" && cmd[i + 1] === "<") {
      const h = readHeredoc(cmd, i);
      if (h) {
        pending.push(h.heredoc);
        out += cmd.slice(i, h.end);
        i = h.end - 1;
        continue;
      }
    }
    out += c;
  }
  return out;
}

export function splitCommand(cmd: string, shell: Shell): string[] {
  const out: string[] = [];
  collect(cmd, shell, out);
  return out
    .map(normalizeCommand)
    .map((s) => simplifySegment(s, shell))
    .filter((s): s is string => s !== null && s.length > 0);
}

export interface CommandWithHeredocs {
  command: string;
  /** Bodies of the heredocs this command reads (<<EOF ... EOF), in order. */
  heredocs: string[];
}

/** Like splitCommand, but keeps the heredoc bodies, each with the command whose `<<` it belongs to. */
export function splitWithHeredocs(cmd: string, shell: Shell): CommandWithHeredocs[] {
  const out: string[] = [];
  const heredocs = new Map<number, string[]>();
  collect(cmd, shell, out, heredocs);
  return out
    .map((command, i) => ({ command: simplifySegment(command.trim(), shell), heredocs: heredocs.get(i) ?? [] }))
    .filter((c): c is CommandWithHeredocs => c.command !== null && c.command.length > 0);
}

// A variable assignment: NAME=value, value unquoted, "quoted", 'quoted', $(…) or `…`.
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=(?:"(?:[^"\\]|\\.)*"|'[^']*'|\$\((?:[^()]|\([^()]*\))*\)|`[^`]*`|[^\s"'`$]+|\$)*/;

/**
 * Removes shell syntax around a command, so rules see the command itself:
 *   "do npm test" → "npm test", "if grep -q x f" → "grep -q x f", "FOO=1 npm test" → "npm test"
 * Returns null for parts that run nothing themselves: "done", "fi", "{", "for f in *.ts", "T=$(mktemp -d)".
 * Commands inside $(…) are extracted and checked separately, so dropping the assignment loses nothing.
 * Dangerous environment variables (LD_PRELOAD, NODE_OPTIONS, …) are caught by deny rules on the whole command.
 */
export function simplifySegment(segment: string, shell: Shell): string | null {
  if (shell !== "bash") return segment;
  let s = segment;
  for (;;) {
    const before = s;
    s = s.replace(/^(?:do|then|else|elif|if|while|until|!)\s+/, "");
    const m = ASSIGNMENT.exec(s);
    if (m && m[0].length > 0 && (m[0].length === s.length || /\s/.test(s[m[0].length]))) s = s.slice(m[0].length).trimStart();
    if (s === before) break;
  }
  if (!s) return null;
  if (/^(?:done|fi|esac|then|do|else|\{|\}|\(|\))$/.test(s)) return null;
  if (/^for\s+(?:[A-Za-z_]\w*\s+in\b|\(\()/.test(s) || /^case\s/.test(s)) return null;
  return s;
}

interface Heredoc {
  word: string;
  /** <<- strips leading tabs from the terminator line. */
  stripTabs: boolean;
  /** <<'EOF' / <<"EOF": no expansion inside the body. */
  quoted: boolean;
}

/** Parses a heredoc operator at `i` (cmd[i..i+1] === "<<"). Returns the operator's end index and delimiter. */
function readHeredoc(cmd: string, i: number): { end: number; heredoc: Heredoc } | null {
  // `<<<` is a here-string, not a heredoc (check both ends so its 2nd/3rd "<" don't match either).
  if (cmd[i] !== "<" || cmd[i + 1] !== "<" || cmd[i + 2] === "<" || cmd[i - 1] === "<") return null;
  let j = i + 2;
  const stripTabs = cmd[j] === "-";
  if (stripTabs) j++;
  while (cmd[j] === " " || cmd[j] === "\t") j++;
  const q = cmd[j];
  if (q === "'" || q === '"') {
    const close = cmd.indexOf(q, j + 1);
    if (close === -1) return null;
    return { end: close + 1, heredoc: { word: cmd.slice(j + 1, close), stripTabs, quoted: true } };
  }
  const m = /^[^\s;&|<>()]+/.exec(cmd.slice(j));
  if (!m) return null;
  return { end: j + m[0].length, heredoc: { word: m[0].replace(/\\/g, ""), stripTabs, quoted: m[0].includes("\\") } };
}

/** Skips the bodies of pending heredocs, starting just after the newline that ends the operator's line. */
function skipHeredocBodies(
  cmd: string,
  start: number,
  pending: Heredoc[]
): { next: number; bodies: Array<{ text: string; quoted: boolean }> } {
  const bodies: Array<{ text: string; quoted: boolean }> = [];
  let pos = start;
  for (const h of pending) {
    const bodyStart = pos;
    let bodyEnd = cmd.length;
    while (pos < cmd.length) {
      const nl = cmd.indexOf("\n", pos);
      const lineEnd = nl === -1 ? cmd.length : nl;
      const line = cmd.slice(pos, lineEnd).replace(/\r$/, "");
      const atEnd = nl === -1 ? cmd.length : nl + 1;
      if ((h.stripTabs ? line.replace(/^\t+/, "") : line) === h.word) {
        bodyEnd = pos;
        pos = atEnd;
        break;
      }
      pos = atEnd;
    }
    bodies.push({ text: cmd.slice(bodyStart, bodyEnd), quoted: h.quoted });
  }
  return { next: pos, bodies };
}

function findClose(cmd: string, start: number, shell: Shell): number {
  let depth = 1;
  let quote: string | null = null;
  let pending: Heredoc[] = [];
  for (let i = start; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (quote === '"' && ((shell === "bash" && c === "\\") || (shell === "powershell" && c === "`"))) i++;
      continue;
    }
    if ((shell === "bash" && c === "\\") || (shell === "powershell" && c === "`")) {
      i++;
    } else if (shell === "bash" && c === "<" && cmd[i + 1] === "<") {
      const h = readHeredoc(cmd, i);
      if (h) {
        pending.push(h.heredoc);
        i = h.end - 1;
      } else {
        i++;
      }
    } else if (c === "\n" && pending.length) {
      // Heredoc bodies may contain quotes and parentheses ("don't (yet)"), which must not count.
      i = skipHeredocBodies(cmd, i + 1, pending).next - 1;
      pending = [];
    } else if (c === "'" || c === '"') {
      quote = c;
    } else if (c === "(") {
      depth++;
    } else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return cmd.length;
}

/** Commands bash would run from an unquoted heredoc body: its $(...) and backtick substitutions. */
function collectSubstitutions(body: string, shell: Shell, out: string[], heredocs?: Map<number, string[]>): void {
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\") {
      i++;
    } else if (body[i] === "$" && body[i + 1] === "(") {
      const end = findClose(body, i + 2, shell);
      collect(body.slice(i + 2, end), shell, out, heredocs);
      i = end;
    } else if (body[i] === "`") {
      const found = body.indexOf("`", i + 1);
      const end = found === -1 ? body.length : found;
      collect(body.slice(i + 1, end), shell, out, heredocs);
      i = end;
    }
  }
}

/** Splits `cmd` into `out`. With `heredocs`, also records each heredoc body under the index of its command in `out`. */
function collect(cmd: string, shell: Shell, out: string[], heredocs?: Map<number, string[]>): void {
  const escapeChar = shell === "bash" ? "\\" : "`";
  let cur = "";
  let quote: '"' | "'" | null = null;
  let pendingHeredocs: Heredoc[] = [];
  // The body follows the line the `<<` is on, possibly after other commands: remember whose heredoc it is.
  let curHeredocs = 0;
  let owners: number[] = [];
  const flush = () => {
    if (cur.trim()) {
      out.push(cur);
      for (; curHeredocs > 0; curHeredocs--) owners.push(out.length - 1);
    }
    cur = "";
    curHeredocs = 0;
  };

  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    const next = cmd[i + 1];

    if (quote === "'") {
      cur += c;
      if (c === "'") quote = null;
      continue;
    }

    if (c === escapeChar && next !== undefined) {
      cur += c + next;
      i++;
      continue;
    }

    const isSubstitution =
      (c === "$" && next === "(") || (shell === "bash" && quote === null && (c === "<" || c === ">") && next === "(");
    if (isSubstitution) {
      const end = findClose(cmd, i + 2, shell);
      collect(cmd.slice(i + 2, end), shell, out, heredocs);
      // Keep the substitution in this command's text, minus any heredoc bodies inside it (data, not code).
      cur += stripHeredocBodies(cmd.slice(i, end + 1), shell);
      i = end;
      continue;
    }

    if (shell === "bash" && c === "`") {
      const found = cmd.indexOf("`", i + 1);
      const end = found === -1 ? cmd.length : found;
      collect(cmd.slice(i + 1, end), shell, out, heredocs);
      cur += cmd.slice(i, end + 1);
      i = end;
      continue;
    }

    if (quote === '"') {
      cur += c;
      if (c === '"') quote = null;
      continue;
    }

    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
      continue;
    }

    if (shell === "bash" && c === "<" && next === "<") {
      const h = readHeredoc(cmd, i);
      if (h) {
        pendingHeredocs.push(h.heredoc);
        curHeredocs++;
        cur += cmd.slice(i, h.end);
        i = h.end - 1;
        continue;
      }
    }

    if (c === "\n" && pendingHeredocs.length) {
      flush();
      const { next: after, bodies } = skipHeredocBodies(cmd, i + 1, pendingHeredocs);
      bodies.forEach((body, k) => {
        const owner = owners[k];
        if (heredocs && owner !== undefined) heredocs.set(owner, [...(heredocs.get(owner) ?? []), body.text]);
      });
      for (const body of bodies) if (!body.quoted) collectSubstitutions(body.text, shell, out, heredocs);
      pendingHeredocs = [];
      owners = [];
      i = after - 1;
      continue;
    }

    if (c === "\n" || c === ";") {
      flush();
      continue;
    }

    if (c === "&") {
      // Redirections like 2>&1 or &> are not command separators.
      if (cmd[i - 1] === ">" || cmd[i - 1] === "<" || next === ">") {
        cur += c;
        continue;
      }
      if (next === "&") i++;
      flush();
      continue;
    }

    if (c === "|") {
      if (next === "|" || next === "&") i++;
      flush();
      continue;
    }

    cur += c;
  }
  flush();
}
