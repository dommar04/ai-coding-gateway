import { tmpdir } from "node:os";
import { resolve } from "node:path";

// A rule is written like Claude Code permissions: `Tool` or `Tool(pattern)`.
//   Bash(git *)        any git command ("git" alone also matches: a trailing " *" is optional)
//   Shell(git *)       the same for Bash and PowerShell (groups: Shell, FileEdit, File)
//   Edit({cwd}/**)     any file inside the current project
//   mcp__github__*     every tool of that MCP server
// Wildcards: `*` = anything, `?` = one character. In path patterns `*` stays inside one
// folder and `**` crosses folders. Placeholders: {cwd} = project folder, {home} = home folder, {tmp} = system temp folder.

export interface ParsedRule {
  tool: string;
  pattern: string | null;
}

export function parseRule(rule: string): ParsedRule {
  const match = /^([^()\s]+)(?:\(([\s\S]*)\))?$/.exec(rule.trim());
  if (!match) {
    throw new Error(`Invalid rule "${rule}". Expected Tool or Tool(pattern), e.g. Bash(git *)`);
  }
  const pattern = match[2];
  return { tool: match[1], pattern: pattern === undefined || pattern === "" ? null : pattern };
}

export type SubjectKind = "command" | "path" | "url";

export interface Subject {
  kind: SubjectKind;
  value: string;
  /** Case-insensitive matching (PowerShell commands, Windows paths). */
  caseInsensitive: boolean;
  shell?: "bash" | "powershell";
}

const PATH_TOOLS = new Set(["Read", "Write", "Edit", "MultiEdit", "NotebookEdit"]);
const IS_WINDOWS = process.platform === "win32";

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** What a rule pattern is matched against for a given tool call, or null for tool-name-only matching. */
export function extractSubject(toolName: string, toolInput: unknown, cwd: string): Subject | null {
  const input = (toolInput ?? {}) as Record<string, unknown>;

  if ((toolName === "Bash" || toolName === "PowerShell") && typeof input.command === "string") {
    const shell = toolName === "Bash" ? "bash" : "powershell";
    return { kind: "command", value: input.command, caseInsensitive: shell === "powershell", shell };
  }

  if (PATH_TOOLS.has(toolName)) {
    const raw = typeof input.file_path === "string" ? input.file_path : input.notebook_path;
    if (typeof raw === "string") {
      return { kind: "path", value: normalizePath(resolve(cwd, raw)), caseInsensitive: IS_WINDOWS };
    }
  }

  if (toolName === "WebFetch" && typeof input.url === "string") {
    return { kind: "url", value: input.url, caseInsensitive: false };
  }

  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

export function globToRegex(pattern: string, kind: SubjectKind | "tool", caseInsensitive: boolean): RegExp {
  let body = pattern;
  let optionalTail = "";
  // "git *" should also match plain "git".
  if ((kind === "command" || kind === "url") && body.endsWith(" *")) {
    body = body.slice(0, -2);
    optionalTail = "(?: [\\s\\S]*)?";
  }

  let out = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (kind === "path" && body.startsWith("**/", i)) {
      out += "(?:.*/)?";
      i += 2;
    } else if (kind === "path" && body.startsWith("**", i)) {
      out += ".*";
      i += 1;
    } else if (c === "*") {
      out += kind === "path" ? "[^/]*" : "[\\s\\S]*";
    } else if (c === "?") {
      out += kind === "path" ? "[^/]" : "[\\s\\S]";
    } else {
      out += escapeRegex(c);
    }
  }
  return new RegExp(`^${out}${optionalTail}$`, caseInsensitive ? "i" : "");
}

export interface MatchContext {
  cwd: string;
  home: string;
  /** System temp folder; defaults to os.tmpdir(). */
  tmp?: string;
}

function expandPlaceholders(pattern: string, kind: SubjectKind, ctx: MatchContext): string {
  const asPath = (p: string) => (kind === "path" ? normalizePath(p) : p);
  return pattern
    .replace(/\{cwd\}/g, asPath(ctx.cwd))
    .replace(/\{home\}/g, asPath(ctx.home))
    .replace(/\{tmp\}/g, asPath(ctx.tmp ?? tmpdir()));
}

/** Tool groups usable in rules: Shell(git *) covers Bash and PowerShell, and so on. */
export const TOOL_GROUPS: Record<string, string[]> = {
  Shell: ["Bash", "PowerShell"],
  FileEdit: ["Edit", "Write", "MultiEdit", "NotebookEdit"],
  File: ["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"],
};

export function toolMatches(rule: ParsedRule, toolName: string): boolean {
  const group = TOOL_GROUPS[rule.tool];
  if (group) return group.includes(toolName);
  return globToRegex(rule.tool, "tool", false).test(toolName);
}

/**
 * Does the rule match this call? `candidate` is the (part of the) subject being checked;
 * rules without a pattern match on tool name alone.
 */
export function ruleMatches(
  rule: ParsedRule,
  toolName: string,
  subject: Subject | null,
  candidate: string | null,
  ctx: MatchContext
): boolean {
  if (!toolMatches(rule, toolName)) return false;
  if (rule.pattern === null) return true;
  if (!subject || candidate === null) return false;
  const expanded = expandPlaceholders(rule.pattern, subject.kind, ctx);
  return globToRegex(expanded, subject.kind, subject.caseInsensitive).test(candidate);
}

/** "Bash(git status)" -> a tool call, for dry-running a call against the rules. */
export function callFromRuleSyntax(text: string): { toolName: string; toolInput: Record<string, string> } {
  const parsed = parseRule(text);
  // A group stands for its first tool: Shell(x) is tested as Bash(x), File(x) as Read(x).
  const tool = TOOL_GROUPS[parsed.tool]?.[0] ?? parsed.tool;
  const pattern = parsed.pattern;
  if (pattern === null) return { toolName: tool, toolInput: {} };
  if (tool === "Bash" || tool === "PowerShell") return { toolName: tool, toolInput: { command: pattern } };
  if (tool === "WebFetch") return { toolName: tool, toolInput: { url: pattern } };
  if (tool === "NotebookEdit") return { toolName: tool, toolInput: { notebook_path: pattern } };
  return { toolName: tool, toolInput: { file_path: pattern } };
}
