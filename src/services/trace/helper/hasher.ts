// Tokenizer 1 (docs/trace-format.md): content becomes a sequence of 16-bit token hashes, packed as Base64.

// A run of letters, digits, _ and $ is one token; any other non-whitespace character is one, except quotes.
const TOKEN = /[\p{L}\p{N}_$]+|[^\s'"`]/gu;

export function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

/** A token of a file, with its hash and where it is: text.slice(start, end) === the token. */
export interface PositionedToken {
  hash: number;
  start: number;
  end: number;
}

/** The same tokens as tokenize(), with their hashes and character positions (for the report). */
export function tokenizeWithPositions(text: string): PositionedToken[] {
  return Array.from(text.matchAll(TOKEN), (m) => ({
    hash: hashToken(m[0]),
    start: m.index,
    end: m.index + m[0].length,
  }));
}

/** FNV-1a 32-bit over the UTF-8 bytes, lower 16 bits. */
export function hashToken(token: string): number {
  let hash = 2166136261;
  for (const byte of Buffer.from(token, "utf8")) hash = Math.imul(hash ^ byte, 16777619);
  return hash & 0xffff;
}

/** One `seg` value: the tokens' hashes, 2 bytes each (big-endian), as Base64. */
export function encodeSegment(tokens: string[]): string {
  const bytes = Buffer.alloc(tokens.length * 2);
  tokens.forEach((token, i) => bytes.writeUInt16BE(hashToken(token), i * 2));
  return bytes.toString("base64");
}

/** The token hashes of a `seg` value (the reverse of encodeSegment). */
export function decodeSegment(seg: string): number[] {
  const bytes = Buffer.from(seg, "base64");
  return Array.from({ length: Math.floor(bytes.length / 2) }, (_, i) => bytes.readUInt16BE(i * 2));
}
