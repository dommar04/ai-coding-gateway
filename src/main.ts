#!/usr/bin/env node
import "./helpers/warnings";
import { packageVersion } from "./integrations/claude/settings";
import { COMMANDS, USAGE } from "./cli";
import { fail } from "./cli/helper/args";

// Start file of the apichap-gateway command (package.json "bin"). Claude Code runs it for every
// tool call ("hook pre|post|session"); people run it for setup and administration.

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;

  if (command === "--version" || command === "-v" || command === "version") {
    console.log(packageVersion());
    return;
  }

  const run = command ? COMMANDS[command] : undefined;
  if (!run) {
    console.error(["Usage:", ...USAGE].join("\n"));
    process.exit(1);
  }
  try {
    await run(args);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

main();
