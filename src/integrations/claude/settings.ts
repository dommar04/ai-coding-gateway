import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { packageFile } from "../../helpers/paths";

// `init` / `uninstall`: register the gateway's hooks in Claude Code's settings.json,
// so a single `npx @apichap/ai-coding-gateway init` is the whole setup.

const PACKAGE_NAME = "@apichap/ai-coding-gateway";

interface HookHandler {
  type?: string;
  command?: string;
  [key: string]: unknown;
}

interface HookEntry {
  matcher?: string;
  hooks?: HookHandler[];
  [key: string]: unknown;
}

type Settings = Record<string, unknown> & { hooks?: Record<string, HookEntry[] | undefined> };

const PHASES = [
  { event: "PreToolUse", phase: "pre" },
  { event: "PostToolUse", phase: "post" },
  // Context resets (compaction, /clear): the "skip unchanged re-reads" memory must be cleared.
  { event: "PreCompact", phase: "session" },
  { event: "SessionStart", phase: "session" },
] as const;

type Phase = (typeof PHASES)[number]["phase"];

// Our own hook commands, including older forms (global bin, npx, running from a source checkout).
const OUR_COMMAND =
  /(@apichap\/ai-coding-gateway(@\S+)?|apichap-ai-coding-gateway(@\S+)?|apichap-gateway|claude-gateway|[\\/](?:cli|main)\.[jt]s"?)\s+hook\s+(pre|post|session)\b/;

export function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(packageFile("package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "latest";
  } catch {
    return "latest";
  }
}

export function defaultSettingsPath(): string {
  return join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "settings.json");
}

/**
 * The command Claude Code runs on every tool call. Pinned to this version and --prefer-offline,
 * so after the first download npx starts it from its cache without asking the registry.
 */
export interface HookCommandOptions {
  /** Use the globally installed `apichap-gateway` command (fastest startup). */
  installed?: boolean;
  /**
   * Run exactly this copy of the gateway, e.g. a local checkout: the path of its start file
   * (src/main.ts is run with tsx, dist/main.js with node).
   */
  localEntry?: string;
}

export function hookCommand(phase: Phase, options: HookCommandOptions = {}): string {
  if (options.localEntry) {
    const entry = options.localEntry.replace(/\\/g, "/");
    return `${entry.endsWith(".ts") ? "npx tsx" : "node"} "${entry}" hook ${phase}`;
  }
  if (options.installed) return `apichap-gateway hook ${phase}`;
  return `npx -y --prefer-offline ${PACKAGE_NAME}@${packageVersion()} hook ${phase}`;
}

function readSettings(path: string): Settings {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8").replace(/^﻿/, "");
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Settings;
  } catch {
    // fall through
  }
  throw new Error(`${path} is not valid JSON. Fix it first; nothing was changed.`);
}

/** Removes our hook handlers; drops entries that end up empty. Returns how many handlers were removed. */
function removeOurHooks(settings: Settings): number {
  let removed = 0;
  for (const { event } of PHASES) {
    const entries = settings.hooks?.[event];
    if (!Array.isArray(entries)) continue;
    const kept: HookEntry[] = [];
    for (const entry of entries) {
      const handlers = Array.isArray(entry.hooks) ? entry.hooks : [];
      const others = handlers.filter((h) => !(typeof h.command === "string" && OUR_COMMAND.test(h.command)));
      removed += handlers.length - others.length;
      if (others.length > 0 || handlers.length === 0) kept.push({ ...entry, hooks: others });
    }
    if (kept.length) settings.hooks![event] = kept;
    else delete settings.hooks![event];
  }
  if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;
  return removed;
}

function writeSettings(path: string, settings: Settings): string | null {
  mkdirSync(dirname(path), { recursive: true });
  let backup: string | null = null;
  if (existsSync(path)) {
    backup = `${path}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    copyFileSync(path, backup);
  }
  writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
  return backup;
}

export interface InstallResult {
  path: string;
  backup: string | null;
  replaced: number;
  commands: string[];
}

export function installHooks(options: { path?: string } & HookCommandOptions = {}): InstallResult {
  const path = options.path ?? defaultSettingsPath();
  const settings = readSettings(path);
  const replaced = removeOurHooks(settings);
  settings.hooks ??= {};
  const commands: string[] = [];
  for (const { event, phase } of PHASES) {
    const command = hookCommand(phase, options);
    commands.push(command);
    const entries = settings.hooks[event] ?? [];
    entries.push({ matcher: "*", hooks: [{ type: "command", command }] });
    settings.hooks[event] = entries;
  }
  const backup = writeSettings(path, settings);
  return { path, backup, replaced, commands };
}

export function uninstallHooks(options: { path?: string } = {}): { path: string; backup: string | null; removed: number } {
  const path = options.path ?? defaultSettingsPath();
  const settings = readSettings(path);
  const removed = removeOurHooks(settings);
  const backup = removed > 0 ? writeSettings(path, settings) : null;
  return { path, backup, removed };
}
