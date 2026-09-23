// Input strategies change a tool call before it runs (PreToolUse `updatedInput`), which is cheaper
// than cleaning up the result afterwards. They only have on/off: the effect can't be measured
// without changing the call. A short note tells the agent what was limited (sent after the call).

export interface InputRewrite {
  input: Record<string, unknown>;
  note: string;
}

export interface InputStrategy {
  id: string;
  title: string;
  description: string;
  group: "Before the call runs";
  defaultState: "on" | "off";
  applies(toolName: string): boolean;
  rewrite(input: Record<string, unknown>, cwd: string): InputRewrite | null;
}
