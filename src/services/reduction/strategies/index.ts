// Output reduction strategies, one per file. Each can be set to on / measure / off on the
// dashboard's Token savings page. They run in the order listed here.

import { ansi } from "./ansi";
import { progress } from "./progress";
import { blankLines } from "./blank-lines";
import { repeatedLines } from "./repeated-lines";
import { jsonCompact } from "./json-compact";
import { testOutput } from "./test-output";
import { installLogs } from "./install-logs";
import { frameworkLogs } from "./framework-logs";
import { stackTraces } from "./stack-traces";
import { generatedDiffs } from "./generated-diffs";
import { longLines } from "./long-lines";
import { repeatedRead } from "./repeated-read";
import { paging } from "./paging";
import type { OutputStrategy } from "./shared";

export { NOTE, type OutputContext, type OutputStrategy, type StrategyState } from "./shared";
export { PAGING } from "./paging";

/** All output strategies, in the order they run. */
export const OUTPUT_STRATEGIES: OutputStrategy[] = [
  ansi,
  progress,
  blankLines,
  repeatedLines,
  jsonCompact,
  testOutput,
  installLogs,
  frameworkLogs,
  stackTraces,
  generatedDiffs,
  longLines,
  repeatedRead,
  paging,
];
