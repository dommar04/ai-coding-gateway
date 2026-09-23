import { objectFields } from "./types";

/** Bash and PowerShell: { stdout, stderr, interrupted, ... }. */
export const shellAdapter = objectFields(["stdout", "stderr"]);
