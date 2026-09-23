import { NOTE, type OutputStrategy } from "./shared";

export const repeatedRead: OutputStrategy = {
  id: "repeated-read",
  title: "Skip unchanged re-reads",
  description:
    "When Claude reads the same file range again in the same session and nothing changed, it gets a short note instead of the content again. Resets when the conversation is compacted or cleared.",
  group: "Repeated content",
  defaultState: "measure",
  applies: (t, field) => t === "Read" && field === "content",
  apply: (text, ctx) => {
    if (!ctx.previousRead) return text;
    const when = new Date(ctx.previousRead.at).toLocaleTimeString("en-GB");
    const ref = ctx.previousRead.callId ? ` (call #${ctx.previousRead.callId})` : "";
    return `${NOTE} Unchanged since you read it at ${when}${ref}; not repeated to save tokens. If you no longer have it in context, read it again with an explicit offset (e.g. offset: 1).`;
  },
};
