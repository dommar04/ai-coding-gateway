// node:sqlite prints an ExperimentalWarning on every start. It is noise for a CLI and for hooks,
// so drop exactly that warning. Must be imported before anything that loads node:sqlite.
const originalEmitWarning = process.emitWarning;

process.emitWarning = function (warning: string | Error, ...rest: unknown[]) {
  const message = typeof warning === "string" ? warning : warning?.message;
  if (typeof message === "string" && message.includes("SQLite is an experimental feature")) return;
  return (originalEmitWarning as (...args: unknown[]) => void).call(process, warning, ...rest);
} as typeof process.emitWarning;

export {};
