import { sql } from "../database";

// Table settings: key/value pairs (mode, policy_source, defaults_version, reduction:<id>, ...).

export function getSetting(key: string): string | undefined {
  return (sql(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined)?.value;
}

export function setSetting(key: string, value: string): void {
  sql(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`).run(key, value);
}

/** All settings whose key starts with `prefix`, keyed without the prefix. */
export function listSettings(prefix: string): Map<string, string> {
  const rows = sql(`SELECT key, value FROM settings WHERE substr(key, 1, ?) = ?`).all(prefix.length, prefix) as Array<{
    key: string;
    value: string;
  }>;
  return new Map(rows.map((r) => [r.key.slice(prefix.length), r.value]));
}
