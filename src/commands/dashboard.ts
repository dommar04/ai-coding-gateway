import { fail, parseArgs } from "./args";

// dashboard: start the local web dashboard.

export async function runDashboard(args: string[]): Promise<void> {
  const { flags } = parseArgs(args);
  const explicitPort = typeof flags.port === "string";
  const port = explicitPort ? Number(flags.port) : 4717;
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`Invalid port "${String(flags.port)}".`);

  // Loaded lazily so the hooks never pay for the dashboard code.
  const { startDashboard, openBrowser } = await import("../dashboard/server");
  const dashboard = await startDashboard({ port, portFallback: !explicitPort });
  console.log(`apichap AI Coding Gateway dashboard running at:

  ${dashboard.url}
`);
  console.log("Only reachable from this machine. Press Ctrl+C to stop.");
  if (!flags["no-open"]) openBrowser(dashboard.url);

  const stop = () => dashboard.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
