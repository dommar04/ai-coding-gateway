# Contributing

Thanks for helping improve the apichap AI Coding Gateway. This page covers setting up the project, how it's organized, and what a good pull request looks like.

## Setup

Requires Node.js 22.13 or newer.

```bash
npm install
npm test            # all tests (node:test through tsx)
npm run typecheck   # TypeScript, plus the dashboard's browser modules
npm run format      # Prettier
npm run build       # compiles to dist/
```

Run the CLI from source with `npx tsx src/main.ts <command>`, for example `npx tsx src/main.ts dashboard`. To have Claude Code use your working copy, run `npx tsx src/main.ts init --local` (see the README, section _Development_).

### Trying it without touching your real data

Set `APICHAP_GATEWAY_DIR` to a scratch folder. The database, error log and spill files then go there instead of `~/.apichap-gateway`:

```bash
APICHAP_GATEWAY_DIR=/tmp/gw npx tsx src/main.ts dashboard
```

To feed a hook by hand, pipe a hook payload into it:

```bash
echo '{"session_id":"s","cwd":"/tmp","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git push --force"},"tool_use_id":"t1"}' \
  | APICHAP_GATEWAY_DIR=/tmp/gw APICHAP_GATEWAY_MODE=enforce npx tsx src/main.ts hook pre
```

## Project layout

```
src/
  main.ts                          start file of the apichap-gateway command (package.json "bin")
  commands/                        one file per command group; index.ts is the command table
    hook.ts                        hook pre|post|session (what Claude Code runs for every tool call)
    setup.ts                       init / uninstall
    dashboard.ts  rules.ts  requests.ts  settings.ts  reduction.ts  activity.ts
  integrations/                    connections to AI coding agents; everything agent-specific lives here
    claude/
      hooks/pre-tool-use.ts        PreToolUse  → gateway.beforeToolCall()
      hooks/post-tool-use.ts       PostToolUse → gateway.afterToolCall()
      hooks/context-reset.ts       PreCompact / SessionStart → gateway.onContextReset()
      hooks/hook-io.ts             read the hook JSON from stdin, write the answer
      hook-input.ts                Claude's hook payloads → ToolCall
      settings.ts                  init / uninstall: the hooks in Claude's settings.json
      transcript.ts                prompt text and API usage from Claude's session transcripts
  dashboard/
    server.ts                      local HTTP server and its JSON API routes
    public/                        the page: index.html, styles.css, js/ (plain ES modules, no build step)
  services/                        agent-neutral logic, no SQL
    gateway.ts                     the workflow: security check → input reduction → log; result reduction → log
    tool-security/
      index.ts                     checkToolSecurity()
      rules.ts  requests.ts        managing rules, approval requests
      messages.ts                  what the agent is told when a call is blocked
      matching/                    rule engine, wildcard patterns, command splitting, rule suggestions
      rule-files/                  rule file format, import / export / defaults
    reduction/
      index.ts                     rewriteToolInput() / reduceToolResult()
      pipeline.ts                  runs the strategies over a result (on / measure / off)
      options.ts                   every strategy's state and savings
      strategies/                  one file per output strategy (ansi.ts, test-output.ts, paging.ts, ...)
      input-strategies/            one file per input strategy (read-limit.ts, grep-limit.ts, ...)
      adapters/                    one file per tool result shape (shell.ts, read.ts, mcp.ts, ...)
    activity/events.ts             event sinks (e.g. a central audit log later)
    settings/                      enforcement mode, policy source (local / managed)
  storage/                         all SQL lives here
    database.ts                    connection, pragmas, prepared-statement cache, transactions, migration runner
    migrations/                    numbered migrations (001-initial-schema.ts, 002-default-rules.ts, ...)
    tables/                        one file per table with all its queries (tool-calls.ts, tool-rules.ts, ...)
  entities/                        shared types (ToolCall, ToolResult, ...)
  helpers/                         small utilities (JSON, paths, errors, call summary)
rules/                             default rules and the rule-file JSON Schema
test/                              tests; test/fixtures/ holds realistic tool output
```

**Adding support for another agent** (e.g. Cursor) means a new folder under `integrations/`. It translates that agent's payloads into a `ToolCall` (`src/entities/tool-call.ts`), calls `services/gateway.ts`, and translates the answer back. The services stay unchanged.

**Adding a command** means a file in `commands/` and an entry in `commands/index.ts`.

**Changing the database schema** means a new file in `storage/migrations/` (next number) added to the list in `migrations/index.ts`. Never edit a migration that has been released: the database remembers how many have run (`PRAGMA user_version`) and runs each one exactly once. Queries go into the table's file in `storage/tables/`.

## Guidelines

- **No runtime dependencies.** The package runs from `npx` on every tool call, so startup time and install size matter. Use Node's built-ins (`node:sqlite`, `node:http`, ...).
- **Never break the user's session.** Hooks catch every error, and in PostToolUse a failing strategy falls back to the original result.
- **The gateway only tightens.** Hooks never return `permissionDecision: "allow"`, so Claude Code's own permission prompts always still apply.
- **Dashboard:** no inline `<script>`, `<style>` or `style="..."`. The Content-Security-Policy forbids them. Put CSS in `styles.css` and code in a module under `js/`.

### Adding or changing default rules

1. Edit `rules/default-rules.json`. Use one rule per line, `Shell(...)` for Bash and PowerShell, and a `note` on every deny rule. The note is what Claude and the user see when the rule blocks.
2. Raise `version` in the file, so existing installs are offered the update.
3. Add a case to `test/rules.test.ts`: what the rule must block, and similar commands it must not block.

### Adding a token reduction strategy

1. Add it to `src/services/reduction/strategies.ts` with a clear `title` and `description`. Both appear on the dashboard's Token savings page.
2. Start new strategies that drop information in `measure` mode (`defaultState`).
3. Test it with **real output** from the tool, and put larger samples in `test/fixtures/`. The test must show that failures, errors and warnings survive. That matters more than how much gets removed.
4. Never rewrite `Read` results in content. Claude needs the exact file text to edit files.

## Branches and releases

- Work on a `feature/*` branch and open a pull request into `develop`. Dependabot also opens its pull requests into `develop`.
- Every merge into `develop` publishes a pre-release like `0.1.1-dev.42` under the npm `dev` tag. Try it with `npx @apichap/ai-coding-gateway@dev`.
- To release, bump `version` in `package.json` on `develop` (and move the `CHANGELOG.md` entries under that version), then open a pull request from `develop` into `main`. The merge publishes that version as `latest`, tags it and creates a GitHub release. A merge without a version bump publishes nothing.
- Publishing only runs after the full test matrix has passed for that commit (`.github/workflows/release.yml`).

## Pull requests

- Keep them focused, and describe the problem and how you verified the fix.
- `npm test`, `npm run typecheck` and `npm run format:check` must pass. CI runs them on Linux, Windows and macOS.
- For user-visible changes, add a line to `CHANGELOG.md` under _Unreleased_.
