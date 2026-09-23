import { estimateTokens } from "../tokens";
import { isObj, str, type Adapter } from "./types";

/** Edit, Write, MultiEdit, NotebookEdit: the agent only sees a short confirmation, so nothing to reduce. */
export const confirmationAdapter: Adapter = {
  fields: () => [],
  withFields: (r) => r,
  visibleTokens: (r) => 12 + (isObj(r) ? estimateTokens(str(r.filePath)) : 0),
};
