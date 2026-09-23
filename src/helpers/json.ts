/** JSON.stringify that never returns undefined (stores "null" instead). */
export function safeStringify(value: unknown): string {
  const json = JSON.stringify(value);
  return json === undefined ? "null" : json;
}

/** Parses a JSON array of strings; anything else becomes an empty list. */
export function parseJsonList(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Parses JSON, falling back to the raw text when it isn't JSON. */
export function parseJsonOrText(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
