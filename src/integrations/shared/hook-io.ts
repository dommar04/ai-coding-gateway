// Command hooks receive JSON on stdin and return their answer on stdout.

export async function readHookInput<T>(): Promise<T> {
  const text = await new Promise<string>((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
  return JSON.parse(text.replace(/^﻿/, "")) as T;
}

/** Writes the hook's answer. No output object means "no opinion". */
export function reply(hookSpecificOutput?: Record<string, unknown>): void {
  process.stdout.write(hookSpecificOutput ? JSON.stringify({ hookSpecificOutput }) : "{}");
}
