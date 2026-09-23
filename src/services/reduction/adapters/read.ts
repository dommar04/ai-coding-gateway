import { IMAGE_TOKENS, estimateTokens } from "../tokens";
import { isObj, str, type Adapter } from "./types";

/** Read: { type, file: { content, ... } }. The agent sees the content with a line-number prefix (~6 chars per line). */
export const readAdapter: Adapter = {
  fields: (r) => {
    const file = isObj(r) && isObj(r.file) ? r.file : null;
    return file && typeof file.content === "string" ? [{ name: "content", text: file.content }] : [];
  },
  withFields: (r, fields) => {
    if (!isObj(r) || !isObj(r.file)) return r;
    const content = fields.find((f) => f.name === "content");
    return content ? { ...r, file: { ...r.file, content: content.text } } : r;
  },
  visibleTokens: (r) => {
    if (!isObj(r)) return 0;
    if (r.type === "image") return IMAGE_TOKENS;
    const content = isObj(r.file) ? str(r.file.content) : "";
    const lines = content ? content.split("\n").length : 0;
    return estimateTokens(content) + Math.ceil((lines * 6) / 4);
  },
};
