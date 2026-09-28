import { getSetting, setSetting } from "../../storage/tables/settings";

// Gateway-wide settings: enforcement mode.

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
