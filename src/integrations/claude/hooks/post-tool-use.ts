import { runIntegrationHook } from "../../shared/hooks";
import { integrationFor } from "../..";
export async function runPostToolUse(): Promise<void> {
  await runIntegrationHook("post", integrationFor("claude"));
}
