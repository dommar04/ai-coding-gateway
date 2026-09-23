import type { DatabaseSync } from "node:sqlite";

/** One schema or data change. Runs exactly once, inside a transaction. Never edit a released migration: add a new one. */
export interface Migration {
  id: string;
  up(db: DatabaseSync): void;
}
