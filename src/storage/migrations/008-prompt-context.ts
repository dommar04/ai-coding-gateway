import type { Migration } from "./types";
export const promptContext: Migration = {
  id: "008-prompt-context",
  up(db) {
    db.exec(`ALTER TABLE prompts ADD COLUMN project TEXT;
      ALTER TABLE prompts ADD COLUMN transcript_path TEXT;
      CREATE INDEX prompts_session ON prompts(session_id, integration);
      UPDATE prompts SET project = (SELECT project FROM tool_calls WHERE tool_calls.prompt_id = prompts.prompt_id LIMIT 1),
        transcript_path = (SELECT transcript_path FROM tool_calls WHERE tool_calls.prompt_id = prompts.prompt_id LIMIT 1);`);
  },
};
