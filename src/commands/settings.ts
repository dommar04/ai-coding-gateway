import {
  MODES,
  POLICY_SOURCES,
  getMode,
  getPolicySource,
  setMode,
  setPolicySource,
  type Mode,
  type PolicySource,
} from "../services/settings";
import { fail } from "./args";

// mode and policy: the gateway-wide settings.

export function runMode(value: string | undefined): void {
  if (value === undefined) {
    console.log(
      `Mode: ${getMode()}${process.env.APICHAP_GATEWAY_MODE ? ` (overridden by APICHAP_GATEWAY_MODE=${process.env.APICHAP_GATEWAY_MODE})` : ""}`
    );
    return;
  }
  if (!MODES.includes(value as Mode)) fail(`Mode must be one of: ${MODES.join(", ")}`);
  setMode(value as Mode);
  console.log(`Mode set to ${value}.`);
}

export function runPolicy(value: string | undefined): void {
  if (value === undefined) {
    console.log(`Policy source: ${getPolicySource()}`);
    return;
  }
  if (!POLICY_SOURCES.includes(value as PolicySource)) fail(`Policy source must be one of: ${POLICY_SOURCES.join(", ")}`);
  setPolicySource(value as PolicySource);
  console.log(`Policy source set to ${value}.`);
}
