import { integrationFor } from "../integrations";
import { runIntegrationHook } from "../integrations/shared/hooks";
import { fail, parseArgs } from "./args";
export async function runHook(args: string[]): Promise<void> {
  const { positional, flags } = parseArgs(args);
  const phase = positional[0];
  if (!phase || !["pre", "post", "session", "prompt"].includes(phase))
    fail("Usage: apichap-gateway hook pre|post|session|prompt --agent claude|codex");
  const integration = integrationFor(typeof flags.agent === "string" ? flags.agent : undefined);
  await runIntegrationHook(phase, integration);
  process.exit(0);
}
