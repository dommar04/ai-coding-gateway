import { DB_PATH } from "../storage/database";
import { listRecentCalls } from "../storage/tables/tool-calls";
import { summarizeInput } from "../helpers/summary";
import { truncate } from "./args";

// list [n]: the last tool calls from the call log.

export function runList(limit: number): void {
  const rows = listRecentCalls(limit).reverse();

  if (rows.length === 0) {
    console.log("No tool calls logged yet.");
    console.log(`(database: ${DB_PATH})`);
    return;
  }

  for (const row of rows) {
    const at = row.completed_at ?? row.started_at ?? "";
    const time = at ? at.slice(11, 19) : "??:??:??";
    const status =
      row.decision === "denied"
        ? "⛔ denied"
        : row.decision === "would_deny"
          ? `${row.completed_at ? "✓ completed" : "… pending"}, would be denied`
          : row.completed_at
            ? "✓ completed"
            : "… pending";
    console.log(`${time}  ${row.tool_name ?? "?"}  [${status}]`);
    console.log(`         ${truncate(summarizeInput(row.tool_input), 100)}`);
    if (row.tool_result) {
      console.log(`         -> ${truncate(String(row.tool_result), 100)}`);
    }
    console.log("");
  }
}

/** Splits argv into positional args and --flags (a flag followed by a non-flag takes it as its value). */
