import { fail, parseArgs } from "../helper/args";
import { DASHBOARD_PORT, openBrowser, stopRunning, waitForPort } from "../../dashboard/autostart";

// dashboard: start the local web dashboard (restarts a running one). dashboard --stop: stop the running one.

export async function runDashboard(args: string[]): Promise<void> {
  const { flags } = parseArgs(args);
  const port = typeof flags.port === "string" ? Number(flags.port) : DASHBOARD_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`Invalid port "${String(flags.port)}".`);

  if (flags.stop) {
    console.log((await stopRunning(port)) ? "Dashboard stopped." : "No dashboard is running.");
    return;
  }

  // Loaded lazily so the hooks never pay for the dashboard code.
  const { startDashboard } = await import("../../dashboard/server");
  let dashboard: Awaited<ReturnType<typeof startDashboard>>;
  const stop = () => dashboard.close().then(() => process.exit(0));
  let restarted = false;
  try {
    dashboard = await startDashboard({ port, onStop: stop });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    // Our own dashboard (only it accepts the stored token): restart it, e.g. to run a new version.
    if (!(await stopRunning(port))) fail(`Port ${port} is already in use by another program. Free it or use --port.`);
    await waitForPort(true, port);
    dashboard = await startDashboard({ port, onStop: stop });
    restarted = true;
  }
  if (restarted) console.log("Restarted the running dashboard.");
  console.log(`Your viewtower.ai Developer Dashboard is running at:

  ${dashboard.url}
`);
  console.log("Only reachable from this machine. Press Ctrl+C to stop.");
  if (!flags["no-open"]) openBrowser(dashboard.url);

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
