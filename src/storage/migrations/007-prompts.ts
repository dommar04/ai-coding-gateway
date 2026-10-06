import type { Migration } from "./types";
export const prompts: Migration = {
  id: "007-prompts",
  up(db) {
    db.exec(`CREATE TABLE prompts (
      prompt_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      integration TEXT NOT NULL,
      text TEXT NOT NULL,
      submitted_at TEXT NOT NULL
    ) STRICT`);
  },
};
