import { objectFields, type Adapter } from "./types";
import { estimateTokens } from "../tokens";

/** Bash and PowerShell: { stdout, stderr, interrupted, ... }. */
const objectAdapter = objectFields(["stdout", "stderr"]);
export const shellAdapter: Adapter = {
  fields: (r) => (typeof r === "string" ? [{ name: "stdout", text: r }] : objectAdapter.fields(r)),
  withFields: (r, fields) => (typeof r === "string" ? (fields[0]?.text ?? r) : objectAdapter.withFields(r, fields)),
  visibleTokens: (r) => (typeof r === "string" ? estimateTokens(r) : objectAdapter.visibleTokens(r)),
};
