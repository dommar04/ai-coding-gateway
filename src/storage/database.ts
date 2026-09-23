import { DatabaseSync, type StatementSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS } from "./migrations";

// The SQLite connection. Tables and their queries live in storage/tables/, one file per table;
// the schema is created and changed only by the numbered migrations in storage/migrations/.

/** APICHAP_GATEWAY_DIR relocates all gateway data (used by tests; handy for trying things out). */
export const GATEWAY_DIR = process.env.APICHAP_GATEWAY_DIR || join(homedir(), ".apichap-gateway");
// A new file name for the migration-managed schema: databases from development builds (gateway.db)
// are simply left alone, nothing has to be renamed or converted.
export const DB_PATH = join(GATEWAY_DIR, "gateway.sqlite");

let db: DatabaseSync | undefined;
const statements = new Map<string, StatementSync>();
let transactionDepth = 0;

export function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(GATEWAY_DIR, { recursive: true });
  db = open();
  migrate(db);
  return db;
}

export function closeDb(): void {
  statements.clear();
  db?.close();
  db = undefined;
}

/** A prepared statement for this SQL, compiled once per process and reused. */
export function sql(text: string): StatementSync {
  let statement = statements.get(text);
  if (!statement) {
    statement = getDb().prepare(text);
    statements.set(text, statement);
  }
  return statement;
}

/** Runs `fn` in one transaction. Nested calls join the outer transaction. */
export function transaction<T>(fn: () => T): T {
  const database = getDb();
  if (transactionDepth > 0) return fn();
  // IMMEDIATE takes the write lock up front, so two hook processes can't interleave.
  database.exec("BEGIN IMMEDIATE");
  transactionDepth++;
  try {
    const result = fn();
    database.exec("COMMIT");
    return result;
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  } finally {
    transactionDepth--;
  }
}

function open(): DatabaseSync {
  const database = new DatabaseSync(DB_PATH);
  database.exec(`
    PRAGMA journal_mode = WAL;     -- the dashboard reads while hook processes write
    PRAGMA synchronous = NORMAL;   -- safe with WAL, much faster writes
    PRAGMA busy_timeout = 3000;    -- wait for short write locks instead of failing
    PRAGMA foreign_keys = ON;
  `);
  return database;
}

// ---------- migrations ----------
// PRAGMA user_version holds how many migrations have run. Each pending migration runs once, in
// order, in its own transaction; the version is bumped in the same transaction.

function schemaVersion(database: DatabaseSync): number {
  return (database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
}

function migrate(database: DatabaseSync): void {
  for (let version = schemaVersion(database); version < MIGRATIONS.length; version = schemaVersion(database)) {
    database.exec("BEGIN IMMEDIATE");
    try {
      // Another process may have migrated while we waited for the lock.
      if (schemaVersion(database) === version) {
        MIGRATIONS[version].up(database);
        database.exec(`PRAGMA user_version = ${version + 1}`);
      }
      database.exec("COMMIT");
    } catch (err) {
      database.exec("ROLLBACK");
      throw new Error(`Database migration ${MIGRATIONS[version].id} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
