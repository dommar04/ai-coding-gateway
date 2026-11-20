import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PACKAGE_ROOT } from "../../helpers/paths";
import { getDb } from "../../storage/database";
import { integrationFor } from "../../integrations";
import { parseArgs } from "../helper/args";
import { logError } from "../../helpers/errors";
import { managed } from "../../services/company/session";
import { syncNow } from "../../services/company/sync";
import { DASHBOARD_URL, restartDashboard } from "../../dashboard/autostart";
import { runLogin } from "./login";
import { installRuntime, removeRuntime } from "../../integrations/shared/runtime";

// init / uninstall: register or remove the selected integration's hooks.

export async function runInit(args: string[]): Promise<void> {
  const { flags } = parseArgs(args);
  const integration = integrationFor(typeof flags.agent === "string" ? flags.agent : undefined);
  const path = typeof flags.settings === "string" ? flags.settings : undefined;
  // --local: the hooks run this checkout's build with node (fast), also when init runs from src with tsx.
  const localEntry = flags.local ? localBuild() : undefined;
  getDb(); // create the database with the starter rules right away
  // Order: login (fails → nothing installed), then hooks, then dashboard.
  if (flags.login) {
    await runLogin(
      [
        ...(typeof flags.login === "string" ? ["--email", flags.login] : []),
        ...(typeof flags.server === "string" ? ["--server", flags.server] : []),
      ],
      { dashboard: false }
    );
    console.log("");
  }
  // Default: hooks run a fixed copy with node (fast); --installed uses the global command.
  const entry = localEntry ?? (flags.installed ? undefined : installRuntime());
  const result = integration.installHooks({ path, installed: flags.installed === true, localEntry: entry });
  console.log(
    `✔ viewtower AI-Coding Governance hooks registered in ${integration.name}${localEntry ? ` (local copy: ${localEntry})` : "."}`
  );
  if (result.replaced) console.log(`  replaced ${result.replaced} earlier gateway hook(s)`);
  console.log("");
  console.log(`Your ${integration.name} sessions are now audited by viewtower. Open the developer dashboard and get started.`);
  if (integration.setupNotes) console.log(integration.setupNotes);
  if (!flags.login) console.log("Login to use the managed version of viewtower.ai:  npx viewtower login");
  console.log("");
  console.log(`Your Developer Dashboard: ${DASHBOARD_URL}`);
  await restartDashboard();
}

/**
 * This checkout's dist/main.js. Hooks never run src with tsx: starting tsx on every tool call is slow.
 * Run from src (tsx), it builds first, so the hooks get the current code.
 */
function localBuild(): string {
  if (__filename.endsWith(".ts")) {
    console.log("Building this checkout for the hooks (npm run build)…");
    // shell: npm is npm.cmd on Windows. A running --local session may miss a hook call while dist is rebuilt.
    const build = spawnSync("npm", ["run", "build"], { cwd: PACKAGE_ROOT, stdio: "inherit", shell: true });
    if (build.status !== 0) throw new Error("npm run build failed; the hooks were not changed.");
  }
  const entry = join(PACKAGE_ROOT, "dist", "main.js");
  if (!existsSync(entry)) throw new Error("No build found (dist/main.js). Run npm run build first.");
  return entry;
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
  // The runtime copy is shared by all agents: remove it only when none still has hooks.
  if (!["claude", "codex"].some((id) => integrationFor(id).hooksInstalled())) removeRuntime();
}
