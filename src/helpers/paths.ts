import { join } from "node:path";

/** The package root (where package.json and rules/ live), from src/helpers (tsx) or dist/helpers (built). */
export const PACKAGE_ROOT = join(__dirname, "..", "..");

export const packageFile = (...parts: string[]) => join(PACKAGE_ROOT, ...parts);
