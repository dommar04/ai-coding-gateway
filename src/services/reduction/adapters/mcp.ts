import { IMAGE_TOKENS, estimateTokens } from "../tokens";
import { isObj, str, type Adapter } from "./types";

/** MCP tools: an array of content blocks ({type: "text", text} / {type: "image", ...}), or { content: [...] }. */
export const mcpAdapter: Adapter = {
  fields: (r) => {
    const blocks = Array.isArray(r) ? r : isObj(r) && Array.isArray(r.content) ? r.content : [];
    return blocks.flatMap((b, i) =>
      isObj(b) && b.type === "text" && typeof b.text === "string" ? [{ name: `block${i}`, text: b.text }] : []
    );
  },
  withFields: (r, fields) => {
    const replace = (blocks: unknown[]) =>
      blocks.map((b, i) => {
        const f = fields.find((x) => x.name === `block${i}`);
        return f && isObj(b) ? { ...b, text: f.text } : b;
      });
    if (Array.isArray(r)) return replace(r);
    if (isObj(r) && Array.isArray(r.content)) return { ...r, content: replace(r.content) };
    return r;
  },
  visibleTokens: (r) => {
    const blocks = Array.isArray(r) ? r : isObj(r) && Array.isArray(r.content) ? r.content : [];
    return blocks.reduce<number>(
      (n, b) => n + (isObj(b) ? (b.type === "image" ? IMAGE_TOKENS : estimateTokens(str(b.text))) : 0),
      0
    );
  },
};
