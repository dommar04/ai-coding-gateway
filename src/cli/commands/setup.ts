import { resolve } from "node:path";
import { getDb } from "../../storage/database";
import { integrationFor } from "../../integrations";
import { parseArgs } from "../helper/args";
import { logError } from "../../helpers/errors";
import { managed } from "../../services/company/session";
import { syncNow } from "../../services/company/sync";

// init / uninstall: register or remove the selected integration's hooks.

export function runInit(args: string[]): void {
  const { flags } = parseArgs(args);
  const integration = integrationFor(typeof flags.agent === "string" ? flags.agent : undefined);
  const path = typeof flags.settings === "string" ? flags.settings : undefined;
  // --local: the hooks run exactly this copy (the start file this command was run from).
  const localEntry = flags.local ? resolve(process.argv[1]) : undefined;
  const result = integration.installHooks({ path, installed: flags.installed === true, localEntry });
  getDb(); // create the database with the starter rules right away
  console.log(
    `✔ apichap AI Coding Gateway hooks registered in ${integration.name}${localEntry ? ` (local copy: ${localEntry})` : ""}`
  );
  console.log(`  settings: ${result.path}${result.backup ? ` (backup: ${result.backup})` : ""}`);
  if (result.replaced) console.log(`  replaced ${result.replaced} earlier gateway hook(s)`);
  console.log("");
  console.log(`New ${integration.name} sessions are now tracked. The default mode is enforce; existing mode settings are kept.`);
  if (integration.setupNotes) console.log(integration.setupNotes);
  console.log("Open the dashboard:  npx apichap-ai-coding-gateway dashboard");
  console.log("Log in to sync your company rules:  npx apichap-ai-coding-gateway login");
}

export async function runUninstall(args: string[]): Promise<void> {
  const { flags } = parseArgs(args);
  const integration = integrationFor(typeof flags.agent === "string" ? flags.agent : undefined);
  const path = typeof flags.settings === "string" ? flags.settings : undefined;
  // Best effort: tell the company server the hooks are gone.
  if (managed()) await syncNow(false).catch((err) => logError("sync", err));
  const result = integration.uninstallHooks({ path });
  console.log(
    result.removed
      ? `Removed ${result.removed} gateway hook(s) from ${result.path} (backup: ${result.backup}). Your data in the gateway folder was kept.`
      : `No gateway hooks found in ${result.path}.`
  );
}
