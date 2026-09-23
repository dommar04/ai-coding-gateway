import { listStrategies, setStrategyState } from "../services/reduction/options";
import { tokenTotals } from "../storage/tables/tool-calls";
import type { StrategyState } from "../services/reduction/strategies";
import { fail, fmt } from "./args";

// reduction: list the token reduction options, or switch one.

export function runReduction(args: string[]): void {
  const [action, id, state] = args;
  if (action === "set") {
    if (!id || !state) fail("Usage: apichap-gateway reduction set <id> on|measure|off");
    setStrategyState(id, state as StrategyState);
    console.log(`${id} set to ${state}.`);
    return;
  }
  if (action !== undefined && action !== "list") fail(`Unknown reduction action "${action}".`);
  const t = tokenTotals();
  console.log(`Tool results: ${fmt(t.resultTokens)} tokens in ${fmt(t.calls)} calls · saved ${fmt(t.savedTokens)} · measure-only options would save ${fmt(t.potentialTokens)} more
`);
  let group = "";
  for (const s of listStrategies()) {
    if (s.group !== group) console.log(`${(group = s.group)}:`);
    const stats =
      s.savedTokens || s.measuredTokens
        ? `  saved ${fmt(s.savedTokens)}${s.measuredTokens ? `, would save ${fmt(s.measuredTokens)}` : ""}`
        : "";
    console.log(`  ${s.state.padEnd(8)} ${s.id.padEnd(16)} ${s.title}${stats}`);
  }
  console.log("\nChange with: apichap-gateway reduction set <id> on|measure|off");
}
