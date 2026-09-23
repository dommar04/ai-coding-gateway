import { estimateTokens } from "../tokens";
import type { Adapter } from "./types";

/** Any other tool: no rewriting; tokens estimated from the serialized result. */
export const opaqueAdapter: Adapter = {
  fields: () => [],
  withFields: (r) => r,
  visibleTokens: (r) => (typeof r === "string" ? estimateTokens(r) : estimateTokens(JSON.stringify(r ?? ""))),
};
