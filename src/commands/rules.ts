import { writeFileSync } from "node:fs";
import { callFromRuleSyntax } from "../services/tool-security/matching/pattern";
import {
  defaultsStatus,
  exportRules,
  formatRuleFile,
  importRules,
  resetToDefaults,
  type ImportMode,
} from "../services/tool-security/rule-files/rule-sets";
import { readRuleFile } from "../services/tool-security/rule-files/rule-file";
import { addRule, evaluateCall, listRules, removeRule, setRuleEnabled } from "../services/tool-security/rules";
import { fail, parseArgs, parseId } from "./args";

// rules: list, add, enable/disable/remove, test, export, import, reset.

export function runRules(args: string[]): void {
  const [action, ...rest] = args;
  const { positional, flags } = parseArgs(rest);

  switch (action) {
    case undefined:
    case "list": {
      const rules = listRules();
      for (const effect of ["deny", "allow"] as const) {
        console.log(effect === "deny" ? "DENY rules (checked first):" : "\nALLOW rules:");
        for (const r of rules.filter((x) => x.effect === effect)) {
          const off = r.enabled ? "" : "  [disabled]";
          console.log(`  #${String(r.id).padEnd(4)} ${r.rule.padEnd(45)} ${r.note ?? ""}${off}`);
        }
      }
      return;
    }
    case "add": {
      const [effect, rule] = positional;
      if ((effect !== "allow" && effect !== "deny") || !rule) {
        fail('Usage: apichap-gateway rules add allow|deny "Tool(pattern)" [--note "why"]');
      }
      const note = typeof flags.note === "string" ? flags.note : null;
      const id = addRule(effect, rule, note, "manual");
      console.log(`Added ${effect} rule #${id}: ${rule}`);
      return;
    }
    case "enable":
    case "disable": {
      const id = parseId(positional[0]);
      if (!setRuleEnabled(id, action === "enable")) fail(`Rule #${id} does not exist.`);
      console.log(`Rule #${id} ${action}d.`);
      return;
    }
    case "remove": {
      const id = parseId(positional[0]);
      if (!removeRule(id)) fail(`Rule #${id} does not exist.`);
      console.log(`Rule #${id} removed.`);
      return;
    }
    case "export": {
      const text = formatRuleFile(exportRules());
      if (typeof flags.out === "string") {
        writeFileSync(flags.out, text);
        console.log(`Exported rules to ${flags.out}`);
      } else {
        process.stdout.write(text);
      }
      return;
    }
    case "import": {
      if (!positional[0]) fail("Usage: apichap-gateway rules import <file.json> [--merge]   (default: replace all rules)");
      const mode: ImportMode = flags.merge ? "merge" : "replace";
      const r = importRules(readRuleFile(positional[0]), mode);
      console.log(
        mode === "replace"
          ? `Replaced all rules: removed ${r.removed}, imported ${r.added}. Now ${r.total} rules.`
          : `Merged: added ${r.added} new rules. Now ${r.total} rules.`
      );
      return;
    }
    case "reset": {
      const mode: ImportMode = flags.merge ? "merge" : "replace";
      const r = resetToDefaults(mode);
      const d = defaultsStatus();
      console.log(
        mode === "replace"
          ? `Reset to ${d.name} v${d.version}: removed ${r.removed}, imported ${r.added}. Now ${r.total} rules.`
          : `Added ${r.added} missing rules from ${d.name} v${d.version}. Now ${r.total} rules.`
      );
      return;
    }
    case "test": {
      if (!positional[0]) fail('Usage: apichap-gateway rules test "Bash(git status && rm -rf x)" [--cwd path]');
      const { toolName, toolInput } = callFromRuleSyntax(positional[0]);
      const cwd = typeof flags.cwd === "string" ? flags.cwd : process.cwd();
      const verdict = evaluateCall(toolName, toolInput, cwd);
      for (const p of verdict.parts) {
        console.log(
          `  ${p.allowedBy ? "✓" : "✗"} ${p.part}${p.allowedBy ? `   (allow #${p.allowedBy.id} ${p.allowedBy.rule})` : "   (no allow rule)"}`
        );
      }
      if (verdict.decision === "allow") {
        console.log("\nVerdict: ALLOWED");
      } else if (verdict.reason === "rule") {
        console.log(`\nVerdict: DENIED by rule #${verdict.rule.id} ${verdict.rule.rule} (${verdict.rule.note ?? ""})`);
        if (verdict.matched) console.log(`         matched on: ${verdict.matched}`);
      } else {
        console.log("\nVerdict: DENIED (not on the allowlist, would file an approval request)");
      }
      return;
    }
    default:
      fail(`Unknown rules action "${action}".`);
  }
}
