import { getSetting, setSetting } from "../../storage/tables/settings";

// Gateway-wide settings: enforcement mode and where the policy comes from.

export type Mode = "enforce" | "monitor" | "off";
export const MODES: Mode[] = ["enforce", "monitor", "off"];

// ---------- policy source ----------
// "local": this machine's database is the source of truth and can be edited (single developer).
// "managed": rules come from an organization; everything that changes policy is refused here,
// in the service layer, so neither the CLI nor the dashboard can bypass it.

export type PolicySource = "local" | "managed";
export const POLICY_SOURCES: PolicySource[] = ["local", "managed"];

export class PolicyLockedError extends Error {
  constructor(action: string) {
    super(`Cannot ${action}: policy is managed by your organization.`);
    this.name = "PolicyLockedError";
  }
}

export function getPolicySource(): PolicySource {
  return getSetting("policy_source") === "managed" ? "managed" : "local";
}

export function setPolicySource(source: PolicySource): void {
  setSetting("policy_source", source);
}

export function assertLocalPolicy(action: string): void {
  if (getPolicySource() === "managed") throw new PolicyLockedError(action);
}

// ---------- mode ----------

export function getMode(): Mode {
  const value = getSetting("mode");
  return MODES.includes(value as Mode) ? (value as Mode) : "enforce";
}

export function setMode(mode: Mode): void {
  assertLocalPolicy("change the enforcement mode");
  setSetting("mode", mode);
}

/** APICHAP_GATEWAY_MODE overrides the stored mode: the escape hatch if the database itself is broken. */
export function modeOverride(): Mode | undefined {
  const value = process.env.APICHAP_GATEWAY_MODE;
  return MODES.includes(value as Mode) ? (value as Mode) : undefined;
}

/** The mode that applies right now (override first, then the stored mode). */
export function effectiveMode(): Mode {
  return modeOverride() ?? getMode();
}
