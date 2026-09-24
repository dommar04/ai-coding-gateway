import { resolve } from "node:path";
import { getDb } from "../storage/database";
import { installHooks, uninstallHooks } from "../integrations/claude/settings";
import { parseArgs } from "./args";

// init / uninstall: register or remove the gateway's hooks in Claude Code.

export function runInit(args: string[]): void {
  const { flags } = parseArgs(args);
  const path = typeof flags.settings === "string" ? flags.settings : undefined;
  // --local: the hooks run exactly this copy (the start file this command was run from).
  const localEntry = flags.local ? resolve(process.argv[1]) : undefined;
  const result = installHooks({ path, installed: flags.installed === true, localEntry });
  getDb(); // create the database with the starter rules right away
  console.log(`✔ apichap AI Coding Gateway hooks registered in Claude Code${localEntry ? ` (local copy: ${localEntry})` : ""}`);
  console.log(`  settings: ${result.path}${result.backup ? ` (backup: ${result.backup})` : ""}`);
  if (result.replaced) console.log(`  replaced ${result.replaced} earlier gateway hook(s)`);
  console.log("");
  console.log("New Claude Code sessions are now tracked. It starts in monitor mode, so nothing is blocked yet.");
  console.log("Open the dashboard:  npx apichap-ai-coding-gateway dashboard");
}

export function runUninstall(args: string[]): void {
  const { flags } = parseArgs(args);
  const path = typeof flags.settings === "string" ? flags.settings : undefined;
  const result = uninstallHooks({ path });
  console.log(
    result.removed
      ? `Removed ${result.removed} gateway hook(s) from ${result.path} (backup: ${result.backup}). Your data in the gateway folder was kept.`
      : `No gateway hooks found in ${result.path}.`
  );
}
