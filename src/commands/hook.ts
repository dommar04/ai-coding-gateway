import { runContextReset } from "../integrations/claude/hooks/context-reset";
import { runPostToolUse } from "../integrations/claude/hooks/post-tool-use";
import { runPreToolUse } from "../integrations/claude/hooks/pre-tool-use";
import { fail } from "./args";

// hook pre|post|session: what Claude Code runs for every tool call (payload on stdin).
export async function runHook(args: string[]): Promise<void> {
  const [phase] = args;
  if (phase === "pre") await runPreToolUse();
  else if (phase === "post") await runPostToolUse();
  else if (phase === "session") await runContextReset();
  else fail("Usage: apichap-gateway hook pre|post|session");
  process.exit(0);
}
