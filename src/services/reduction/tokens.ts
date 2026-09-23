// Token counts are estimates: ~4 characters per token is the usual rule of thumb for English
// text and code. Good enough to compare before/after and to spot the expensive calls.

export const CHARS_PER_TOKEN = 4;
/** Rough cost of one image block (e.g. a browser screenshot) in the model's context. */
export const IMAGE_TOKENS = 1500;

export function estimateTokens(text: string | null | undefined): number {
  return text ? Math.ceil(text.length / CHARS_PER_TOKEN) : 0;
}
