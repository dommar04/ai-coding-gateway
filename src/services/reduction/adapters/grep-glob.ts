import { estimateTokens } from "../tokens";
import { isObj, str, type Adapter } from "./types";

/** Grep and Glob: { content } in Grep's content mode, otherwise { filenames: [...] }. */
export const grepGlobAdapter: Adapter = {
  fields: (r) => (isObj(r) && typeof r.content === "string" && r.content ? [{ name: "content", text: r.content }] : []),
  withFields: (r, fields) => {
    const content = fields.find((f) => f.name === "content");
    return isObj(r) && content ? { ...r, content: content.text } : r;
  },
  visibleTokens: (r) => {
    if (!isObj(r)) return 0;
    const names = Array.isArray(r.filenames) ? r.filenames.join("\n") : "";
    return estimateTokens(str(r.content) || names);
  },
};
