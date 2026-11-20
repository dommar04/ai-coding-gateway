import { spawnSync } from "node:child_process";
import { cpSync, existsSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { PACKAGE_ROOT } from "../../helpers/paths";
import { GATEWAY_DIR } from "../../storage/database";

// A fixed copy of the package, so the hooks start with plain node instead of npx
// (npx is slow per call and may clean its cache folder at any time).

const PARTS = ["dist", "rules", "pipeline", "package.json"];

export const runtimeDir = () => join(GATEWAY_DIR, "runtime");

/** Copies this package to the runtime folder (replacing an older copy) and returns its start file. */
export function installRuntime(from = PACKAGE_ROOT, dir = runtimeDir()): string {
  const entry = join(dir, "dist", "main.js");
  if (resolve(from) === resolve(dir)) return entry; // init was run from the runtime copy itself
  if (!existsSync(join(from, "dist", "main.js")))
    throw new Error("No build found (dist/main.js). Run npm run build first, or use --local.");
  checkNode();
  const tmp = `${dir}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  for (const part of PARTS) {
    if (existsSync(join(from, part))) cpSync(join(from, part), join(tmp, part), { recursive: true });
  }
  // Swap in one step; a hook starting exactly during the swap fails once.
  rmSync(dir, { recursive: true, force: true });
  renameSync(tmp, dir);
  return entry;
}

export function removeRuntime(dir = runtimeDir()): void {
  rmSync(dir, { recursive: true, force: true });
}

/** The hooks run "node" from PATH, which may differ from the node running init. */
function checkNode(): void {
  const version = spawnSync("node", ["--version"], { encoding: "utf8" }).stdout?.trim();
  const [major, minor] = (version?.match(/^v(\d+)\.(\d+)/) ?? []).slice(1).map(Number);
  if (!(major > 22 || (major === 22 && minor >= 13))) {
    throw new Error(
      `The hooks run "node" from your PATH, which ${version ? `is ${version}` : "was not found"}. viewtower needs Node.js 22.13 or newer.`
    );
  }
}
