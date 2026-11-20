import { connect } from "node:net";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { homedir } from "node:os";
import { logError } from "../helpers/errors";
import { getSetting } from "../storage/tables/settings";

// Background start of the dashboard (init, login, agent session start) and the restart logic shared with
// the dashboard command. Hooks import this, so it stays small and does not load the dashboard server.

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

/** Waits until the port is free (free = true) or taken (free = false); false on timeout. */
export async function waitForPort(free: boolean, port = DASHBOARD_PORT, ms = 5000): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) {
    if ((await portInUse(port)) !== free) return true;
  }
  return false;
}

/** Asks our running dashboard to stop; false when none runs or the port belongs to another program. */
export async function stopRunning(port = DASHBOARD_PORT): Promise<boolean> {
  const token = getSetting("dashboard:token");
  if (!token) return false;
  return fetch(`http://127.0.0.1:${port}/api/stop`, {
    method: "POST",
    headers: { "X-Gateway-Token": token },
    signal: AbortSignal.timeout(2000),
  }).then(
    (res) => res.ok,
    () => false
  );
}

export function openBrowser(url: string): void {
  try {
    // Not explorer.exe: it opens the Documents folder instead of the browser for URLs with a query string.
    const [cmd, args] =
      process.platform === "win32"
        ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
        : process.platform === "darwin"
          ? ["open", [url]]
          : ["xdg-open", [url]];
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Not fatal: the URL is printed as well.
  }
}

/**
 * Starts `dashboard --no-open` as a detached child; false when there is no start file.
 * fromSource: also from a checkout run with tsx (src/main.ts with the same loader flags).
 * The hooks pass false, so tests running from src never start a real dashboard.
 */
function spawnDashboard(fromSource: boolean): boolean {
  const ext = extname(__filename);
  if (ext !== ".js" && !fromSource) return false;
  const entry = join(__dirname, "..", `main${ext}`);
  if (!existsSync(entry)) return false;
  // cwd: home, so the long-lived child does not lock the agent's project folder (Windows).
  // Some spawn failures (EAGAIN, EMFILE, ENOENT) arrive as an async 'error' event, not a throw.
  spawn(process.execPath, [...process.execArgv, entry, "dashboard", "--no-open"], {
    cwd: homedir(),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  })
    .on("error", (err) => logError("dashboard", err))
    .unref();
  return true;
}

/** Hooks: starts the dashboard in the background unless something already answers on its port. Never throws. */
export async function ensureDashboard(): Promise<void> {
  try {
    if (!(await portInUse())) spawnDashboard(false);
  } catch (err) {
    logError("dashboard", err);
  }
}

/**
 * init / login: restarts the dashboard (so it runs this version) and opens it in the browser.
 * Never throws; problems are printed, since the background child cannot report them.
 */
export async function restartDashboard(): Promise<void> {
  try {
    if ((await portInUse()) && !((await stopRunning()) && (await waitForPort(true)))) {
      console.log(
        `Port ${DASHBOARD_PORT} is in use by another program (or a dashboard of another viewtower version).` +
          "\n  Stop it, then run: npx viewtower dashboard"
      );
      return;
    }
    if (!spawnDashboard(true) || !(await waitForPort(false))) {
      console.log("The dashboard did not start. Run it in the foreground to see why: npx viewtower dashboard");
      return;
    }
    // Read after the start: the first start creates the token.
    const token = getSetting("dashboard:token");
    openBrowser(token ? `${DASHBOARD_URL}?token=${token}` : DASHBOARD_URL);
  } catch (err) {
    logError("dashboard", err);
  }
}
