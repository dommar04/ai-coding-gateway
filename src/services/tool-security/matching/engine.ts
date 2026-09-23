import { extractSubject, parseRule, ruleMatches, type MatchContext, type ParsedRule, type Subject } from "./pattern";
import { normalizeCommand, splitCommand, stripHeredocBodies } from "./shell";

export interface Rule {
  id: number;
  effect: "allow" | "deny";
  rule: string;
  note: string | null;
}

export interface CallContext {
  toolName: string;
  toolInput: unknown;
  cwd: string;
  home: string;
}

export interface PartResult {
  part: string;
  allowedBy: Rule | null;
}

export type Verdict =
  | { decision: "allow"; subject: Subject | null; parts: PartResult[] }
  | { decision: "deny"; reason: "rule"; rule: Rule; matched: string | null; subject: Subject | null; parts: PartResult[] }
  | { decision: "deny"; reason: "unlisted"; uncovered: string[]; subject: Subject | null; parts: PartResult[] };

interface CompiledRule {
  rule: Rule;
  parsed: ParsedRule;
}

function compile(rules: Rule[]): CompiledRule[] {
  const compiled: CompiledRule[] = [];
  for (const rule of rules) {
    try {
      compiled.push({ rule, parsed: parseRule(rule.rule) });
    } catch {
      // A malformed rule in the table must not break evaluation; it simply never matches.
    }
  }
  return compiled;
}

/**
 * 1. Any deny rule matching the whole command or any part -> deny.
 * 2. Every part covered by an allow rule -> allow.
 * 3. Otherwise -> deny as unlisted (becomes an approval request).
 */
export function evaluate(call: CallContext, rules: Rule[]): Verdict {
  const compiled = compile(rules);
  const denies = compiled.filter((r) => r.rule.effect === "deny");
  const allows = compiled.filter((r) => r.rule.effect === "allow");
  const ctx: MatchContext = { cwd: call.cwd, home: call.home };
  const subject = extractSubject(call.toolName, call.toolInput, call.cwd);

  // What must each be allowed, and what deny rules are checked against.
  let parts: string[];
  let denyCandidates: Array<string | null>;
  // A command made only of shell syntax (e.g. "T=5") runs nothing: no allow rule needed.
  let onlySyntax = false;
  if (subject?.kind === "command") {
    // Heredoc bodies are data: deny rules scanning the whole command must not match text inside them.
    const full = normalizeCommand(stripHeredocBodies(subject.value, subject.shell ?? "bash"));
    parts = splitCommand(subject.value, subject.shell ?? "bash");
    onlySyntax = parts.length === 0;
    denyCandidates = [full, ...parts];
  } else {
    const value = subject ? subject.value : null;
    parts = value === null ? [] : [value];
    denyCandidates = [value];
  }

  const matches = (r: CompiledRule, candidate: string | null) => ruleMatches(r.parsed, call.toolName, subject, candidate, ctx);

  const partResults: PartResult[] = (onlySyntax ? [] : parts.length ? parts : [null]).map((part) => ({
    part: part ?? call.toolName,
    allowedBy: allows.find((r) => matches(r, part))?.rule ?? null,
  }));

  for (const candidate of denyCandidates) {
    const hit = denies.find((r) => matches(r, candidate));
    if (hit) {
      return { decision: "deny", reason: "rule", rule: hit.rule, matched: candidate, subject, parts: partResults };
    }
  }

  const uncovered = partResults.filter((p) => !p.allowedBy).map((p) => p.part);
  if (uncovered.length === 0) {
    return { decision: "allow", subject, parts: partResults };
  }
  return { decision: "deny", reason: "unlisted", uncovered, subject, parts: partResults };
}
