import type { Migration } from "./types";

// Token reduction options are on or off; "measure" is gone. Options left on "measure" become
// "off" (Claude already got the original output then). Drops what only measure mode recorded:
// the per-call potential savings and the per-option "would save" totals.

export const dropMeasureMode: Migration = {
  id: "005-drop-measure-mode",
  up(db) {
    db.exec(`
      UPDATE settings SET value = 'off' WHERE key LIKE 'reduction:%' AND value = 'measure';
      ALTER TABLE tool_calls DROP COLUMN saved_potential;
      DELETE FROM reduction_stats WHERE saved_tokens = 0;
      ALTER TABLE reduction_stats DROP COLUMN measured_tokens;
    `);
  },
};
