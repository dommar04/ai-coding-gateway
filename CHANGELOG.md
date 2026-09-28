# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

First public release.

### Added

- **Setup:** `npx apichap-ai-coding-gateway init` registers the hooks in Claude Code, and `uninstall` removes them again.
- **Rules:** allow and deny rules for every tool call (`Tool(pattern)` with wildcards, `{cwd}` and `{home}`, and the groups `Shell`, `FileEdit` and `File`). A deny rule always wins.
  - Chained commands, substitutions and heredocs are understood.
  - Rule groups: each group is one policy in plain words ("The agent is not allowed to delete files") with the rules behind it. Groups can be switched on or off as a whole, and Claude is told the policy when a rule blocks.
  - Default rules come from `rules/default-rules.json` (16 groups). Reading and searching is allowed inside the project only, and secrets now include `.aws`, `.netrc`, `*.pem` and Claude Code's login file.
  - Import, export and reset work from the dashboard and the CLI. Import shows a preview and can add to or replace the current rules; older rule files without groups still import.
  - Grep and Glob are checked by the folder they search, and the new tool group `FileRead` covers Read, Grep and Glob.
- **Allowing denied calls:** calls no rule allows are denied. Open a denied call on the Activity page to allow it with an exact, a broad or a custom rule. Claude is told that the user can allow it there.
- **Modes:** monitor (log only, the default), enforce and off.
- **Token reduction:** each option can be switched on or off.
  - Lossless cleanup, and condensing of test runs, install and build logs, framework logs and stack traces (JavaScript, Python, Java/Spring, Gradle, .NET, Go, PHP, Ruby, Docker).
  - Paging of long output, and skipping unchanged re-reads.
  - Optional input limits that run before the call.
- **Token tracking:** an estimate for every tool call, and Claude Code's real API usage for every prompt.
- **Dashboard:** a local dashboard with live activity grouped by prompt, project filter, decision reasons, rules management and token savings.
- **Protection:** the default rules stop the agent from switching the gateway off or allowing its own calls.
