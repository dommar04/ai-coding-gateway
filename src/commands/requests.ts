import { parseJsonList } from "../helpers/json";
import { approveRequest, listRequests, rejectRequest } from "../services/tool-security/requests";
import { fail, parseArgs, parseId, truncate } from "./args";

// requests: list, approve, reject.

export function runRequests(args: string[]): void {
  const [action, ...rest] = args;
  const { positional, flags } = parseArgs(rest);

  switch (action) {
    case undefined:
    case "list": {
      const requests = listRequests(flags.all ? "all" : "pending");
      if (requests.length === 0) {
        console.log(flags.all ? "No approval requests." : "No pending approval requests.");
        return;
      }
      for (const r of requests) {
        const status = r.status === "pending" ? "" : `  [${r.status} by ${r.decided_by ?? "?"}]`;
        console.log(`#${r.id}  ${r.tool_name}  (${r.hit_count}x, last ${r.last_seen.slice(0, 16).replace("T", " ")})${status}`);
        if (r.subject) console.log(`      call:   ${truncate(r.subject, 110)}`);
        console.log(`      exact:  ${parseJsonList(r.suggested_exact).join("  ")}`);
        console.log(`      broad:  ${parseJsonList(r.suggested_broad).join("  ")}`);
        if (r.project) console.log(`      in:     ${r.project}`);
        console.log("");
      }
      console.log('Approve with: apichap-gateway requests approve <id> [--broad | --rule "Tool(pattern)"]');
      return;
    }
    case "approve": {
      const id = parseId(positional[0]);
      const custom = typeof flags.rule === "string" ? [flags.rule] : undefined;
      const result = approveRequest(id, { broad: flags.broad === true, custom });
      console.log(`Request #${id} approved. Added allow rule(s):`);
      result.rules.forEach((rule, i) => console.log(`  #${result.ruleIds[i]}  ${rule}`));
      if (result.autoClosed.length) {
        console.log(`Also closed, now covered: ${result.autoClosed.map((x) => `#${x}`).join(", ")}`);
      }
      return;
    }
    case "reject": {
      const id = parseId(positional[0]);
      rejectRequest(id);
      console.log(`Request #${id} rejected.`);
      return;
    }
    default:
      fail(`Unknown requests action "${action}".`);
  }
}
