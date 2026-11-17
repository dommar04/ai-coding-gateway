import { connect } from "node:net";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { logError } from "../helpers/errors";

// Background start of the dashboard (init, login, agent session start). Hooks import this,
// so it stays small and does not load the dashboard server.

export const DASHBOARD_PORT = 4717;
export const DASHBOARD_URL = `http://127.0.0.1:${DASHBOARD_PORT}/`;

/** Something answers on the port (connection refused is instant; the timeout caps slow stacks). */
export function portInUse(port = DASHBOARD_PORT): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    const done = (inUse: boolean) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(300, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/**
 * Starts the dashboard in the background unless something already runs on its port. Never throws.
 * open: also open it in the browser (interactive commands only; the hooks never open it).
 */
export async function ensureDashboard(open = false): Promise<void> {
  try {
    // Built entry only: from src (tests, tsx) there is nothing to start.
    const entry = join(__dirname, "..", "main.js");
    // With open, always start the child: if a dashboard already runs, the child checks that it is ours
    // and only opens the browser (the token in the URL never goes to another program on the port).
    if (!existsSync(entry) || (!open && (await portInUse()))) return;
    // cwd: home, so the long-lived child does not lock the agent's project folder (Windows).
    // Some spawn failures (EAGAIN, EMFILE, ENOENT) arrive as an async 'error' event, not a throw.
    spawn(process.execPath, [entry, "dashboard", ...(open ? [] : ["--no-open"])], {
      cwd: homedir(),
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    })
      .on("error", (err) => logError("dashboard", err))
      .unref();
  } catch (err) {
    logError("dashboard", err);
  }
}
