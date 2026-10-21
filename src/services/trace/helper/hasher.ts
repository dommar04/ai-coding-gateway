// Tokenizer 1 (docs/trace-format.md): content becomes a sequence of 16-bit token hashes, packed as Base64.

// A run of letters, digits, _ and $ is one token; any other non-whitespace character is one, except quotes.
const TOKEN = /[\p{L}\p{N}_$]+|[^\s'"`]/gu;

export function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
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
