# Changelog

Notable changes for each release are listed here. This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 1.0.0

- **Codex support:** Support for Codex. 
- **Rules and protection:** Updated default rules cover both integrations and protect sensitive files and gateway settings. Updating defaults adds missing descriptions without changing users’ notes or enabled settings.
- **Dashboard:** Live activity, prompt details, rule management and token-savings settings are available in one local dashboard.
- **Token savings:** Reduce tool-result output where supported. Codex currently supports tracking and enforcement; output reduction is available for Claude Code.

## 0.1.2

- Improved setup guidance and the GitHub release pipeline.

## 0.1.1

- **Integration setup:** Register or remove the gateway’s Claude Code hooks with the CLI.
- **Tool-call rules:** Allow or deny calls by tool and path, organize policies into rule groups, and manage rules from the dashboard or CLI. Deny rules take precedence, and denied calls can be reviewed and allowed from Activity.
- **Safe defaults:** Keep file access within the project and block access to common secret files. Default rules also prevent an agent from disabling the gateway or changing its own permissions.
- **Enforcement modes:** Choose whether to enforce rules, log decisions without blocking calls, or turn checks off.
- **Token tracking and savings:** Track estimated tokens for tool calls and Claude Code API usage by prompt. Configure supported output reductions, including cleanup and shorter build, test and error output.
- **Dashboard:** Follow live activity by prompt and project, inspect decisions, manage rules and adjust token-savings settings.
