import { fail, parseArgs } from "../helper/args";
import { DASHBOARD_PORT } from "../../dashboard/autostart";
import { getSetting } from "../../storage/tables/settings";

// dashboard: start the local web dashboard.

export async function runDashboard(args: string[]): Promise<void> {
  const { flags } = parseArgs(args);
  const port = typeof flags.port === "string" ? Number(flags.port) : DASHBOARD_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`Invalid port "${String(flags.port)}".`);

  // Loaded lazily so the hooks never pay for the dashboard code.
  const { startDashboard, openBrowser } = await import("../../dashboard/server");
  let dashboard;
  try {
    dashboard = await startDashboard({ port });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    // Our own dashboard (it accepts the stored token): just open it.
    const token = getSetting("dashboard:token");
    const ours =
      !!token &&
      (await fetch(`http://127.0.0.1:${port}/api/stats`, {
        headers: { "X-Gateway-Token": token },
        signal: AbortSignal.timeout(2000),
      }).then(
        (res) => res.ok,
        () => false
      ));
    if (!ours) fail(`Port ${port} is already in use by another program. Free it or use --port.`);
    console.log(`Dashboard already running at http://127.0.0.1:${port}/`);
    if (!flags["no-open"]) openBrowser(`http://127.0.0.1:${port}/?token=${token}`);
    return;
  }
  console.log(`apichap AI Coding Gateway dashboard running at:

  ${dashboard.url}
`);
  console.log("Only reachable from this machine. Press Ctrl+C to stop.");
  if (!flags["no-open"]) openBrowser(dashboard.url);

  const stop = () => dashboard.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
