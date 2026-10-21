// Which tokens of `after` are new compared to `before`: a longest-common-subsequence diff on tokens.

/** Above this many table cells the changed middle counts as added as a whole (a rewrite, not an edit). */
const MAX_CELLS = 4_000_000;

/** The segments of tokens in `after` that are not in `before`, in order. */
export function addedSeg(before: string[], after: string[]): string[][] {
  // Unchanged start and end need no table.
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  const a = before.slice(start, before.length - end);
  const b = after.slice(start, after.length - end);
  if (!b.length) return [];
  if (!a.length || a.length * b.length > MAX_CELLS) return [b];

  // lcs[i * width + j]: length of the longest common subsequence of a[i..] and b[j..].
  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i * width + j] =
        a[i] === b[j] ? lcs[(i + 1) * width + j + 1] + 1 : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);

  const segments: string[][] = [];
  let segment: string[] = [];
  let i = 0;
  let j = 0;
  while (j < b.length) {
    if (i < a.length && a[i] === b[j]) {
      if (segment.length) segments.push(segment);
      segment = [];
      i++;
      j++;
    } else if (i < a.length && lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      i++; // only in before: removed
    } else {
      segment.push(b[j++]); // only in after: added
    }
  }
  if (segment.length) segments.push(segment);
  return segments;
}
