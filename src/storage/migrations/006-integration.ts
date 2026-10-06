import type { Migration } from "./types";
export const integration: Migration = {
  id: "006-integration",
  up(db) {
    db.exec("ALTER TABLE tool_calls ADD COLUMN integration TEXT NOT NULL DEFAULT 'claude'");
  },
};
