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
import {
  addGroup,
  addRule,
  evaluateCall,
  listGroups,
  listRules,
  moveRule,
  removeGroup,
  removeRule,
  resolveGroup,
  setRuleEnabled,
  updateGroup,
} from "../services/tool-security/rules";
import { fail, parseArgs, parseId } from "./args";

// rules: list, add, enable/disable/remove, move, groups, test, export, import, reset.

/** A group given on the command line: its key, or its numeric id. */
const groupRef = (value: string | true | undefined) =>
  typeof value !== "string" ? undefined : /^#?\d+$/.test(value) ? Number(value.replace("#", "")) : value;

export function runRules(args: string[]): void {
  const [action, ...rest] = args;
  const { positional, flags } = parseArgs(rest);

  switch (action) {
    case undefined:
    case "list": {
      const rules = listRules();
      for (const g of listGroups()) {
        const mine = rules.filter((r) => r.group_id === g.id);
        console.log(`\n${g.title}${g.enabled ? "" : "  [group disabled]"}   (${g.key})`);
        for (const r of [...mine.filter((x) => x.effect === "deny"), ...mine.filter((x) => x.effect === "allow")]) {
          const off = r.enabled ? "" : "  [disabled]";
          console.log(`  #${String(r.id).padEnd(4)} ${r.effect.padEnd(5)} ${r.rule.padEnd(45)} ${r.note ?? ""}${off}`);
        }
        if (!mine.length) console.log("  (no rules)");
      }
      console.log("\nDeny rules always win. Anything no allow rule covers is denied too.");
      return;
    }
    case "add": {
      const [effect, rule] = positional;
      if ((effect !== "allow" && effect !== "deny") || !rule) {
        fail('Usage: apichap-gateway rules add allow|deny "Tool(pattern)" [--note "why"] [--group <key>]');
      }
      const note = typeof flags.note === "string" ? flags.note : null;
      const id = addRule(effect, rule, note, "manual", groupRef(flags.group));
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
    case "move": {
      const id = parseId(positional[0]);
      const group = groupRef(positional[1]);
      if (group === undefined) fail("Usage: apichap-gateway rules move <id> <group key>");
      if (!moveRule(id, group)) fail(`Rule #${id} does not exist.`);
      console.log(`Rule #${id} moved to ${positional[1]}.`);
      return;
    }
    case "groups": {
      const [sub, ...more] = positional;
      if (sub === undefined || sub === "list") {
        const rules = listRules();
        for (const g of listGroups()) {
          const n = rules.filter((r) => r.group_id === g.id).length;
          console.log(`  ${g.key.padEnd(28)} ${String(n).padStart(3)} rules  ${g.title}${g.enabled ? "" : "  [disabled]"}`);
        }
        return;
      }
      if (sub === "add") {
        if (!more[0]) fail('Usage: apichap-gateway rules groups add "The agent is not allowed to ..." [--description "why"]');
        const description = typeof flags.description === "string" ? flags.description : null;
        const id = addGroup(more[0], description, "manual");
        console.log(`Added rule group #${id}: ${more[0]}`);
        return;
      }
      if (sub === "enable" || sub === "disable" || sub === "remove") {
        const ref = groupRef(more[0]);
        if (ref === undefined) fail(`Usage: apichap-gateway rules groups ${sub} <group key>`);
        const id = resolveGroup(ref);
        if (sub === "remove") removeGroup(id);
        else updateGroup(id, { enabled: sub === "enable" });
        console.log(`Rule group ${more[0]} ${sub === "remove" ? "removed with its rules" : sub + "d"}.`);
        return;
      }
      fail(`Unknown groups action "${sub}". Use list, add, enable, disable or remove.`);
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
          ? `Replaced all rules: removed ${r.removed}, imported ${r.added} in ${r.groups} groups. Now ${r.total} rules.`
          : `Merged: added ${r.added} new rules and ${r.addedGroups} new groups. Now ${r.total} rules.`
      );
      return;
    }
    case "reset": {
      const mode: ImportMode = flags.merge ? "merge" : "replace";
      const r = resetToDefaults(mode);
      const d = defaultsStatus();
      console.log(
        mode === "replace"
          ? `Reset to ${d.name} v${d.version}: removed ${r.removed}, imported ${r.added} in ${r.groups} groups. Now ${r.total} rules.`
          : `Added ${r.added} missing rules and ${r.addedGroups} groups from ${d.name} v${d.version}. Now ${r.total} rules.`
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
        if (verdict.rule.group_title) console.log(`         policy: ${verdict.rule.group_title}`);
        if (verdict.matched) console.log(`         matched on: ${verdict.matched}`);
      } else {
        console.log("\nVerdict: DENIED (no allow rule covers it)");
      }
      return;
    }
    default:
      fail(`Unknown rules action "${action}".`);
  }
}
