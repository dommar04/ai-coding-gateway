import { splitWithHeredocs } from "../../tool-security/matching/shell";
import type { TextEdit } from "../handler";

// Shell commands that contain the content they write, so it can be traced like a Write:
//   bash:        cat > f <<EOF … EOF, cat >> f, tee [-a] f <<EOF, echo … > f, printf … >> f
//   PowerShell:  Set-Content / Add-Content / Out-File with -Value, a value argument or a piped string,
//                and "text" > f
// Everything a command writes counts as new (before = ""). Commands that copy or generate content
// (cp, formatters, scripts) are not recorded.

const IGNORED_TARGETS = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "$null"]);

export function shellWrites(command: string, shell: "bash" | "powershell"): TextEdit[] {
  return shell === "bash" ? bashWrites(command) : powershellWrites(command);
}

// --- bash ---

function bashWrites(command: string): TextEdit[] {
  const edits: TextEdit[] = [];
  for (const { command: cmd, heredocs } of splitWithHeredocs(command, "bash")) {
    const { args, targets } = bashWords(cmd);
    const program = args.shift();
    const body = heredocs.join("");
    let content: string | null = null;
    const paths = [...targets];
    if (program === "cat" && heredocs.length && !args.length) {
      content = body;
    } else if (program === "tee" && heredocs.length) {
      content = body;
      paths.push(...args.filter((a) => !a.startsWith("-")));
    } else if (program === "echo" && targets.length) {
      const flags = leadingFlags(args, /^-[neE]+$/);
      content = args.join(" ");
      if (flags.includes("e")) content = unescape(content);
    } else if (program === "printf" && targets.length && args[0] !== "-v") {
      content = unescape(args.join(" "));
    }
    if (content === null) continue;
    for (const path of paths) if (!IGNORED_TARGETS.has(path)) edits.push({ path, before: "", after: content });
  }
  return edits;
}

/** The unquoted words of a simple command, and the files its stdout is redirected to. */
function bashWords(cmd: string): { args: string[]; targets: string[] } {
  const args: string[] = [];
  const targets: string[] = [];
  let next: "arg" | "target" | "skip" = "arg";
  for (const token of bashTokens(cmd)) {
    if (token.op !== undefined) {
      // >, >>, 1>, &>, &>> write stdout to a file; 2>, < and <<EOF don't; >&2 / 2>&1 duplicate a descriptor.
      if (token.op.startsWith("<")) next = token.op.startsWith("<<") ? "arg" : "skip";
      else if (/&\d*$/.test(token.op)) next = "arg";
      else next = /^(?:1|&)?>>?$/.test(token.op) ? "target" : "skip";
      continue;
    }
    if (next === "target") targets.push(token.word);
    else if (next === "arg") args.push(token.word);
    next = "arg";
  }
  return { args, targets };
}

type BashToken = { word: string; op?: undefined } | { op: string; word?: undefined };

/** Splits a command into words (quotes removed) and redirection operators (`>`, `2>>`, `<<EOF`, `>&2`, …). */
function bashTokens(cmd: string): BashToken[] {
  const tokens: BashToken[] = [];
  let word = "";
  let inWord = false;
  const end = () => {
    if (inWord) tokens.push({ word });
    word = "";
    inWord = false;
  };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (/\s/.test(c)) {
      end();
    } else if (c === "'") {
      const close = cmd.indexOf("'", i + 1);
      const stop = close === -1 ? cmd.length : close;
      word += cmd.slice(i + 1, stop);
      inWord = true;
      i = stop;
    } else if (c === '"') {
      inWord = true;
      for (i++; i < cmd.length && cmd[i] !== '"'; i++) {
        if (cmd[i] === "\\" && '"\\$`'.includes(cmd[i + 1] ?? "")) i++;
        word += cmd[i];
      }
    } else if (c === "\\" && i + 1 < cmd.length) {
      word += cmd[++i];
      inWord = true;
    } else if (c === ">" || c === "<") {
      // A file descriptor right before the operator (2>, &>) belongs to it.
      let op = /^(?:\d+|&)$/.test(word) && inWord ? word : "";
      if (op) ((word = ""), (inWord = false));
      end();
      const m = /^(?:<<-?\s*(?:'[^']*'|"[^"]*"|[^\s;&|<>()]+)|>>?(?:&\d*)?|<)/.exec(cmd.slice(i));
      op += m ? m[0] : c;
      tokens.push({ op });
      i += (m ? m[0].length : 1) - 1;
    } else {
      word += c;
      inWord = true;
    }
  }
  end();
  return tokens;
}

/** Removes leading flags matching `pattern` from `args`; returns their letters. */
function leadingFlags(args: string[], pattern: RegExp): string {
  let letters = "";
  while (args.length && pattern.test(args[0])) letters += args.shift()!.slice(1);
  return letters;
}

/** \n and \t as echo -e and printf write them. */
function unescape(text: string): string {
  return text.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

// --- PowerShell ---

const PS_WRITERS = /^(?:set-content|add-content|out-file)$/i;
const PS_PATH_PARAMS = /^-(?:path|literalpath|filepath)$/i;
/** Parameters without a value; any other -Name takes the next word (e.g. -Encoding utf8). */
const PS_SWITCHES = /^-(?:nonewline|force|append|passthru|whatif|confirm|noclobber|asbytestream)$/i;

function powershellWrites(command: string): TextEdit[] {
  const edits: TextEdit[] = [];
  for (const stages of powershellStatements(command)) {
    const last = stages[stages.length - 1];
    const words = powershellWords(last);
    const redirect = words.findIndex((w) => w.op === ">" || w.op === ">>");

    // "text" > file
    if (redirect > 0 && stages.length === 1 && words.slice(0, redirect).every((w) => w.literal)) {
      const target = words[redirect + 1]?.value;
      if (target && !IGNORED_TARGETS.has(target))
        edits.push({
          path: target,
          before: "",
          after: words
            .slice(0, redirect)
            .map((w) => w.value)
            .join(" "),
        });
      continue;
    }

    if (!words.length || !PS_WRITERS.test(words[0].value)) continue;
    const cmdlet = words[0].value.toLowerCase();
    let path: string | null = null;
    let value: string | null = null;
    const positional: string[] = [];
    for (let i = 1; i < words.length; i++) {
      const w = words[i];
      if (!w.literal && PS_PATH_PARAMS.test(w.value)) path = words[++i]?.value ?? null;
      else if (!w.literal && /^-(?:value|inputobject)$/i.test(w.value)) value = words[++i]?.value ?? null;
      else if (!w.literal && w.value.startsWith("-")) i += PS_SWITCHES.test(w.value) ? 0 : 1;
      else positional.push(w.value);
    }
    path ??= positional.shift() ?? null;
    if (value === null && cmdlet !== "out-file") value = positional.shift() ?? null;
    // A string piped into the cmdlet: "text" | Set-Content f
    if (value === null && stages.length === 2) {
      const source = powershellWords(stages[0]);
      if (source.length && source.every((w) => w.literal)) value = source.map((w) => w.value).join("\n");
    }
    if (path && value !== null && !IGNORED_TARGETS.has(path)) edits.push({ path, before: "", after: value });
  }
  return edits;
}

/** Statements (split on newlines and ;) and their pipeline stages, respecting quotes and here-strings. */
function powershellStatements(command: string): string[][] {
  const statements: string[][] = [];
  let stages: string[] = [];
  let cur = "";
  const endStage = () => {
    if (cur.trim()) stages.push(cur.trim());
    cur = "";
  };
  const endStatement = () => {
    endStage();
    if (stages.length) statements.push(stages);
    stages = [];
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const quoted = powershellQuoted(command, i);
    if (quoted) {
      cur += command.slice(i, quoted);
      i = quoted - 1;
    } else if (c === "|") {
      endStage();
    } else if (c === ";" || c === "\n") {
      endStatement();
    } else {
      cur += c;
    }
  }
  endStatement();
  return statements;
}

/** If a quoted string or here-string starts at `i`, the index just after it. */
function powershellQuoted(s: string, i: number): number | null {
  if (s[i] === "@" && (s[i + 1] === "'" || s[i + 1] === '"') && /^[ \t]*\r?\n/.test(s.slice(i + 2))) {
    const close = s.indexOf(`\n${s[i + 1]}@`, i + 2);
    return close === -1 ? s.length : close + 3;
  }
  if (s[i] === "'") {
    let j = i + 1;
    while (j < s.length && !(s[j] === "'" && s[j + 1] !== "'")) j += s[j] === "'" ? 2 : 1;
    return Math.min(j + 1, s.length);
  }
  if (s[i] === '"') {
    let j = i + 1;
    while (j < s.length && s[j] !== '"') j += s[j] === "`" ? 2 : 1;
    return Math.min(j + 1, s.length);
  }
  return null;
}

interface PsWord {
  value: string;
  /** Written as a string literal ('…', "…", @'…'@), not a bare word. */
  literal: boolean;
  op?: string;
}

function powershellWords(stage: string): PsWord[] {
  const words: PsWord[] = [];
  for (let i = 0; i < stage.length; i++) {
    if (/\s/.test(stage[i])) continue;
    const quoted = powershellQuoted(stage, i);
    if (quoted) {
      words.push({ value: powershellUnquote(stage.slice(i, quoted)), literal: true });
      i = quoted - 1;
    } else if (stage[i] === ">") {
      const op = stage[i + 1] === ">" ? ">>" : ">";
      words.push({ value: op, literal: false, op });
      i += op.length - 1;
    } else {
      let j = i;
      while (j < stage.length && !/[\s>]/.test(stage[j])) j++;
      words.push({ value: stage.slice(i, j), literal: false });
      i = j - 1;
    }
  }
  return words;
}

function powershellUnquote(s: string): string {
  if (s.startsWith("@")) return s.replace(/^@['"][ \t]*\r?\n/, "").replace(/\r?\n['"]@$/, "");
  if (s.startsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s.slice(1, -1).replace(/`(.)/g, (_, ch: string) => ({ n: "\n", t: "\t" })[ch] ?? ch);
}
