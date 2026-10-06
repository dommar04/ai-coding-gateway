import { runIntegrationHook } from "../../shared/hooks";
import { integrationFor } from "../..";
export async function runContextReset(): Promise<void> {
  await runIntegrationHook("session", integrationFor("claude"));
}
