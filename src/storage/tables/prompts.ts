import { sql } from "../database";
export interface PromptSubmission {
  promptId: string;
  sessionId: string;
  integration: string;
  text: string;
  project?: string;
  transcriptPath?: string;
}
export function recordPrompt(prompt: PromptSubmission): void {
  sql(`INSERT INTO prompts (prompt_id, session_id, integration, text, submitted_at, project, transcript_path) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(prompt_id) DO NOTHING`).run(
    prompt.promptId,
    prompt.sessionId,
    prompt.integration,
    prompt.text,
    new Date().toISOString(),
    prompt.project ?? null,
    prompt.transcriptPath ?? null
  );
}

export function latestPromptId(sessionId: string, integration: string): string | undefined {
  return (
    sql("SELECT prompt_id FROM prompts WHERE session_id = ? AND integration = ? ORDER BY rowid DESC LIMIT 1").get(
      sessionId,
      integration
    ) as { prompt_id: string } | undefined
  )?.prompt_id;
}
export function lastPromptRowId(): number {
  return (sql("SELECT COALESCE(MAX(rowid), 0) AS id FROM prompts").get() as { id: number }).id;
}
export function promptsSince(id: number): Array<{ id: number; prompt_id: string }> {
  return sql("SELECT rowid AS id, prompt_id FROM prompts WHERE rowid > ? ORDER BY rowid LIMIT 500").all(id) as Array<{
    id: number;
    prompt_id: string;
  }>;
}
export function getPrompt(promptId: string): { text: string; submitted_at: string } | undefined {
  return sql("SELECT text, submitted_at FROM prompts WHERE prompt_id = ?").get(promptId) as
    { text: string; submitted_at: string } | undefined;
}
