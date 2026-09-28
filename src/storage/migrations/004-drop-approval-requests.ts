import type { Migration } from "./types";

// Approval requests are gone: a denied call is allowed straight from the activity instead.
// Drops their table and the call log's link to them.

export const dropApprovalRequests: Migration = {
  id: "004-drop-approval-requests",
  up(db) {
    db.exec(`
      DROP TABLE approval_requests;
      ALTER TABLE tool_calls DROP COLUMN request_id;
    `);
  },
};
