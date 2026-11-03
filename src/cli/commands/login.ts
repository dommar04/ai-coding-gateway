import { createInterface } from "node:readline";
import { login } from "../../services/company/session";
import { syncNow } from "../../services/company/sync";
import { deleteSettings } from "../../storage/tables/settings";
import { parseArgs } from "../helper/args";

// login: connect this client to the company server; company rules then sync automatically.

export async function runLogin(args: string[]): Promise<void> {
  const { flags } = parseArgs(args);
  // One interface for all answers: a second one would miss lines the first already buffered (piped stdin).
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (question: string, hidden = false): Promise<string> => {
    rl.setPrompt(question);
    rl.prompt();
    // The prompt is already written; mute the echo of the typed password.
    if (hidden) (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
    const { value, done } = await lines.next();
    if (hidden) process.stdout.write("\n");
    if (done) throw new Error("Login cancelled: no input.");
    return value as string;
  };
  let email: string;
  let password: string;
  try {
    email = (typeof flags.email === "string" ? flags.email : await ask("Email: ")).trim();
    password = await ask("Password: ", true);
  } finally {
    rl.close();
  }
  // Errors (wrong password, server unreachable, no input) end the command via main's fail().
  await login(email, password, typeof flags.server === "string" ? flags.server : undefined);
  try {
    // Hooks may be installed for either agent, so report them as installed.
    const { version, rules } = await syncNow(true);
    console.log(`✔ Logged in as ${email}. Company rules v${version} synced (${rules} rules).`);
  } catch (err) {
    // Rejected (e.g. not assigned to a company): don't stay logged in, or the dashboard locks for nothing.
    const status = (err as { status?: number }).status;
    if (status === 401 || status === 403) {
      deleteSettings("auth:");
      throw err;
    }
    console.log(`✔ Logged in as ${email}. The first sync failed (${err instanceof Error ? err.message : String(err)}).`);
    console.log("  It is retried when the next agent session starts.");
  }
}
