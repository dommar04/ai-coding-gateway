import { getSetting, listSettings, setSetting } from "../../storage/tables/settings";

// Gateway-wide settings: enforcement mode, and features that can be switched off. Set locally in the
// dashboard for now; later a managed workspace will set them.

/** Features that can be switched off, all on by default: trace files, CI report setup, token savings. */
export const FEATURES = ["traces", "pipelines", "tokenSavings"] as const;
export type Feature = (typeof FEATURES)[number];

export function features(): Record<Feature, boolean> {
  const stored = listSettings("feature:");
  return Object.fromEntries(FEATURES.map((f) => [f, stored.get(f) !== "off"])) as Record<Feature, boolean>;
}

export function setFeature(feature: Feature, on: boolean): void {
  setSetting(`feature:${feature}`, on ? "on" : "off");
}

export type Mode = "enforce" | "monitor" | "off";
export const MODES: Mode[] = ["enforce", "monitor", "off"];

export function getMode(): Mode {
  const value = getSetting("mode");
  return MODES.includes(value as Mode) ? (value as Mode) : "enforce";
}

export function setMode(mode: Mode): void {
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
