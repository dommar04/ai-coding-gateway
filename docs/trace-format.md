# Trace format

When tracing is on, the gateway records what an AI agent writes into your project's files. The records are stored in the project itself, in the `.goairside` folder, so they can be committed together with the code they describe.

A trace contains **no code and no line numbers**. Written content is stored as a sequence of short hashes, one per word or symbol. That keeps traces small and lets the recorded content still be recognized after the file has been edited elsewhere, moved around, or reformatted.

## Where traces are stored

```
.goairside/
  traces/
    2026-10-21T09-15-03Z_a1b2c3d4.jsonl
    2026-10-21T14-02-48Z_9f8e7d6c.jsonl
```

- Each agent session gets its own file. The name is the session's start time in UTC, followed by the first 8 characters of the session id.
- A file is only created once the agent changes something. Sessions that only read or talk leave no file behind.
- Because every session writes to its own file, traces from different branches never conflict when merging.

## File structure

Trace files use [JSON Lines](https://jsonlines.org/): UTF-8 text with one JSON object per line. Lines are only ever appended.

Every line has a `kind`. The first line is always the `session` line; each following `change` line describes one write by the agent.

```jsonl
{"kind":"session","format":"goairside-trace","v":1,"tokenizer":1,"session":"a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d","agent":"claude","agentVersion":"2.1.0","gateway":"1.0.0","started":"2026-10-21T09:15:03.412Z"}
{"kind":"change","t":"2026-10-21T09:15:41.087Z","model":"claude-opus-5-5","tool":"Edit","path":"src/app.ts","seg":["PyqRxAfhB3E=","kQ3mAAx1"]}
{"kind":"change","t":"2026-10-21T09:16:02.551Z","model":"claude-opus-5-5","tool":"Write","path":"src/utils/date.ts","seg":["Zx81Q0nP7wE2bA=="]}
```

### `session`

Describes the session the file belongs to.

| Field          | Required | Description                                                      |
| -------------- | -------- | ---------------------------------------------------------------- |
| `kind`         | yes      | Always `"session"`.                                              |
| `format`       | yes      | Always `"goairside-trace"`.                                      |
| `v`            | yes      | Version of the file format (see [Versions](#versions)).          |
| `tokenizer`    | yes      | Version of the tokenizer used for all `seg` values in this file. |
| `session`      | yes      | The agent's session id.                                          |
| `agent`        | yes      | The agent that ran the session: `"claude"` or `"codex"`.         |
| `agentVersion` | no       | The agent's version, when known.                                 |
| `gateway`      | yes      | Version of the gateway that wrote the file.                      |
| `started`      | yes      | Start of the session (ISO 8601, UTC).                            |

### `change`

One line for each time the agent wrote content into a file.

| Field   | Required | Description                                                                 |
| ------- | -------- | --------------------------------------------------------------------------- |
| `kind`  | yes      | Always `"change"`.                                                          |
| `t`     | yes      | Time of the change (ISO 8601, UTC).                                         |
| `model` | no       | The model that made the change, when known. It can change within a session. |
| `tool`  | yes      | The tool used: `Write`, `Edit`, `apply_patch`, `Bash` or `PowerShell`.      |
| `path`  | yes      | The changed file, relative to the project root, with `/` as separator.      |
| `seg`   | yes      | The added content as a list of segments (see below).                        |

A **segment** is one continuous piece of added content. Only what the agent added is recorded:

- **Write:** the whole file content, as one segment.
- **Edit and apply_patch:** only the parts that are new compared to the replaced text. Each new part is its own segment.
- **Bash and PowerShell:** only commands that contain the written content themselves, such as `cat > file <<'EOF' … EOF`, `echo … > file` or `Set-Content`. Commands like formatters or scripts that change files are not recorded.

Changes that only delete content, and files outside the project, are not recorded.

## How content is encoded

A `seg` value is built in four steps (tokenizer version 1):

1. **Split into tokens.** A run of letters, digits, `_` and `$` is one token (`items`, `reduce`, `42`). Every other character is a token of its own (`(`, `=`, `.`).
2. **Skip** whitespace, line breaks and the quote characters `'`, `"` and `` ` ``. This way, formatting and quote style do not change the result.
3. **Hash** each token with 32-bit FNV-1a over its UTF-8 bytes (offset basis `2166136261`, prime `16777619`) and keep the lower 16 bits.
4. **Pack** the hashes of a segment as 2 bytes each (big-endian) and encode them as standard Base64.

For example, `const total = 0;` consists of the tokens `const`, `total`, `=`, `0` and `;`: 5 hashes, stored as 16 Base64 characters. A trace is roughly as large as the content it describes.

Single 16-bit hashes are not unique, and they are not meant to be: content is recognized by long sequences of tokens in the right order, never by a single hash.

## Versions

Two version numbers are stored in the `session` line:

- **`v`** changes when fields are renamed or removed, or when their meaning changes. New optional fields and new kinds of lines do not change it.
- **`tokenizer`** changes whenever the way `seg` values are computed changes, since old and new hashes would no longer match.

Programs reading trace files should:

- ignore fields they don't know,
- skip lines whose `kind` they don't know,
- skip files with a `v` or `tokenizer` they don't support, with a warning instead of an error.
