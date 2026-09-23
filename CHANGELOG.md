# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

First public release.

### Added

- **Setup:** `npx @apichap/ai-coding-gateway init` registers the hooks in Claude Code, and `uninstall` removes them again.
- **Rules:** allow and deny rules for every tool call (`Tool(pattern)` with wildcards, `{cwd}` and `{home}`, and the groups `Shell`, `FileEdit` and `File`). A deny rule always wins.
  - Chained commands, substitutions and heredocs are understood.
  - Default rules come from `rules/default-rules.json`. Import, export and reset work from the dashboard and the CLI.
- **Approvals:** unlisted calls are blocked and filed as approval requests, each with an exact and a broad rule suggestion. Claude is told that an admin has to approve.
- **Modes:** monitor (log only, the default), enforce and off.
- **Token reduction:** each option can be switched on, measured or off.
  - Lossless cleanup, and condensing of test runs, install and build logs, framework logs and stack traces (JavaScript, Python, Java/Spring, Gradle, .NET, Go, PHP, Ruby, Docker).
  - Paging of long output, and skipping unchanged re-reads.
  - Optional input limits that run before the call.
- **Token tracking:** an estimate for every tool call, and Claude Code's real API usage for every prompt.
- **Dashboard:** a local dashboard with live activity grouped by prompt, project filter, decision reasons, approvals, rules management and token savings.
- **Protection:** the default rules stop the agent from switching the gateway off or approving its own requests.
