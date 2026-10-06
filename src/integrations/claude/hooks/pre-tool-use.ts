import { runIntegrationHook } from "../../shared/hooks";
import { integrationFor } from "../..";
export async function runPreToolUse(): Promise<void> {
  await runIntegrationHook("pre", integrationFor("claude"));
}
