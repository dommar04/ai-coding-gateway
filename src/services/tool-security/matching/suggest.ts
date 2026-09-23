import { tmpdir } from "node:os";
import { normalizePath, type Subject } from "./pattern";

export interface Suggestions {
  exact: string[];
  broad: string[];
}

// Tools where the second word is the real "command" (npm run, git commit, docker compose ...).
const TWO_WORD_FAMILIES = new Set([
  "npm",
  "pnpm",
  "yarn",
  "npx",
  "bun",
  "git",
  "gh",
  "docker",
  "docker-compose",
  "podman",
  "kubectl",
  "helm",
  "cargo",
  "go",
  "dotnet",
  "pip",
  "pip3",
  "poetry",
  "uv",
  "brew",
  "az",
  "aws",
  "gcloud",
  "terraform",
  "make",
]);

export function broadCommandPattern(command: string): string {
  const words = command.split(" ");
  const keep = TWO_WORD_FAMILIES.has(words[0]) && words.length > 1 && !words[1].startsWith("-") ? 2 : 1;
  return `${words.slice(0, keep).join(" ")} *`;
}

function withPlaceholders(dir: string, cwd: string, home: string): string {
  const nCwd = normalizePath(cwd);
  const nHome = normalizePath(home);
  const nTmp = normalizePath(tmpdir());
  const lower = (s: string) => (process.platform === "win32" ? s.toLowerCase() : s);
  if (lower(dir) === lower(nCwd) || lower(dir).startsWith(lower(nCwd) + "/")) return "{cwd}" + dir.slice(nCwd.length);
  // The temp folder often lies inside the home folder (Windows), so it is checked first.
  if (lower(dir) === lower(nTmp) || lower(dir).startsWith(lower(nTmp) + "/")) return "{tmp}" + dir.slice(nTmp.length);
  if (lower(dir) === lower(nHome) || lower(dir).startsWith(lower(nHome) + "/")) return "{home}" + dir.slice(nHome.length);
  return dir;
}

/** Ready-to-approve rules for the parts of a call that no allow rule covered. */
export function suggestRules(
  toolName: string,
  subject: Subject | null,
  uncovered: string[],
  cwd: string,
  home: string
): Suggestions {
  const unique = (xs: string[]) => [...new Set(xs)];

  if (!subject) {
    // mcp__<server>__<tool>: the server name may itself contain underscores, the tool is after the last "__".
    const lastSep = toolName.lastIndexOf("__");
    const isMcp = toolName.startsWith("mcp__") && lastSep > "mcp_".length;
    return { exact: [toolName], broad: [isMcp ? `${toolName.slice(0, lastSep)}__*` : toolName] };
  }

  if (subject.kind === "command") {
    return {
      exact: unique(uncovered.map((part) => `${toolName}(${part})`)),
      broad: unique(uncovered.map((part) => `${toolName}(${broadCommandPattern(part)})`)),
    };
  }

  if (subject.kind === "path") {
    const dir = subject.value.slice(0, subject.value.lastIndexOf("/")) || subject.value;
    return {
      exact: [`${toolName}(${withPlaceholders(subject.value, cwd, home)})`],
      broad: [`${toolName}(${withPlaceholders(dir, cwd, home)}/**)`],
    };
  }

  let broadUrl = subject.value;
  try {
    const url = new URL(subject.value);
    broadUrl = `${url.protocol}//${url.host}/*`;
  } catch {
    // keep the exact URL
  }
  return { exact: [`${toolName}(${subject.value})`], broad: [`${toolName}(${broadUrl})`] };
}
