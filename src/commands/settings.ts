import { MODES, getMode, setMode, type Mode } from "../services/settings";
import { fail } from "./args";

// mode: the gateway-wide enforcement setting.

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
