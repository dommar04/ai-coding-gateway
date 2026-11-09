import { transaction } from "../../storage/database";
import { getSetting, setSetting } from "../../storage/tables/settings";
import { logError } from "../../helpers/errors";
import type { Integration } from "../../integrations";
import { setFeature } from "../settings";
import { parseRule } from "../tool-security/matching/pattern";
import type { RuleFile, RuleObject } from "../tool-security/rule-files/rule-file";
import { importRules } from "../tool-security/rule-files/rule-sets";
import { post } from "./api";
import { managed } from "./session";

// Company rules sync: the server's rule groups replace all local rules. The full replace on every
// sync also reverts local edits to the SQLite rules.

const INTERVAL_MS = 5 * 60_000;

export interface CompanyConfig {
  sync_approved_activities: boolean;
  sync_denied_activities: boolean;
  enable_traces: boolean;
  enable_github_pipeline: boolean;
}

export interface SyncBundle {
  version: number;
  config: CompanyConfig;
  rule_groups: Array<{
    id: string;
    title: string;
    subtitle: string | null;
    rules: Array<{ skill: string; command: string | null; comment: string | null; allowed: boolean }>;
  }>;
}

/** Server rule groups as a rule file. Rules the gateway can't parse are skipped (and logged), not fatal. */
export function toRuleFile(bundle: SyncBundle): RuleFile {
  return {
    name: "Company rules",
    version: bundle.version,
    groups: bundle.rule_groups.map((g) => {
      const allow: RuleObject[] = [];
      const deny: RuleObject[] = [];
      for (const r of g.rules) {
        const rule = r.command ? `${r.skill}(${r.command})` : r.skill;
        try {
          parseRule(rule);
        } catch (err) {
          logError("sync", err);
          continue;
        }
        (r.allowed ? allow : deny).push({ rule, ...(r.comment ? { note: r.comment } : {}) });
      }
      return {
        id: `company-${g.id}`.toLowerCase(),
        // A blank title would make the rule file reject every group, so fall back instead.
        title: g.title.trim() || "Company rules",
        ...(g.subtitle ? { description: g.subtitle } : {}),
        allow,
        deny,
      };
    }),
  };
}

export async function syncNow(hooksInstalled: boolean): Promise<{ version: number; rules: number }> {
  const bundle = await post<SyncBundle>("/client/sync", { hooks_installed: hooksInstalled }, true);
  const cfg = bundle.config;
  return transaction(() => {
    const result = importRules(toRuleFile(bundle), "replace", "company");
    setFeature("traces", cfg.enable_traces);
    setFeature("pipelines", cfg.enable_github_pipeline);
    setSetting("company:config", JSON.stringify(cfg));
    setSetting("company:version", String(bundle.version));
    setSetting("company:last_sync", String(Date.now()));
    return { version: bundle.version, rules: result.added };
  });
}

/** Syncs when logged in and the last attempt is 5+ minutes old. Never throws: a failed sync keeps the last rules. */
export async function maybeSync(integration: Integration): Promise<void> {
  try {
    if (!managed()) return;
    const last = Math.max(Number(getSetting("company:last_sync") ?? 0), Number(getSetting("company:last_attempt") ?? 0));
    if (Date.now() - last < INTERVAL_MS) return;
    // Throttle on attempts too, so an unreachable server isn't asked on every prompt.
    setSetting("company:last_attempt", String(Date.now()));
    await syncNow(integration.hooksInstalled());
  } catch (err) {
    logError("sync", err);
  }
}
