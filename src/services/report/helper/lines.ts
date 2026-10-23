/** [3, 4, 5, 9, 12, 13] → "3–5, 9, 12–13". */
export function lineRanges(lines: number[]): string {
  return lineBlocks(lines)
    .map(([start, end]) => (start === end ? `${start}` : `${start}–${end}`))
    .join(", ");
}

/** Sorted lines → their runs of consecutive lines: [3, 4, 5, 9] → [[3, 5], [9, 9]]. */
export function lineBlocks(lines: number[]): Array<[number, number]> {
  const blocks: Array<[number, number]> = [];
  for (let i = 0; i < lines.length; i++) {
    const start = lines[i];
    while (lines[i + 1] === lines[i] + 1) i++;
    blocks.push([start, lines[i]]);
  }
  return blocks;
}
