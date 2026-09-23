import { isShell, NOTE, MIN_DROPPED, type OutputStrategy } from "./shared";

const INSTALL_NOISE = [
  // Python, Node, Rust, Debian
  /^\s*(Collecting|Downloading|Using cached|Requirement already satisfied|Obtaining|Building wheel|Created wheel|Stored in directory)\b/,
  /^npm (http|timing|sill|verb)\b/,
  /^\s*(Resolving|Fetching|Linking|Progress:)\b.*\d/,
  /^\s*Compiling \S+ v\d/, // cargo
  /^\s*Downloaded \S+ v\d/,
  /^\s*(Unpacking|Selecting previously unselected|Preparing to unpack|Setting up|Get:\d+|Hit:\d+)\b/, // apt
  // Java: Maven and Gradle
  /^(\[INFO\] )?Download(ing|ed) from \S+: /, // Maven artifact downloads
  /^Progress \(\d+\): /, // Maven download progress
  /^\[INFO\]\s*$/, // Maven empty info lines
  /^Download(ing)? https?:\/\//, // Gradle downloads
  /^> Task :\S+( (UP-TO-DATE|NO-SOURCE|FROM-CACHE|SKIPPED))?$/, // Gradle tasks that did nothing notable (FAILED stays)
  /^<[=-]+> \d+% (EXECUTING|CONFIGURING|INITIALIZING)/, // Gradle progress bar
  // .NET, PHP, Ruby
  /^\s*(Determining projects to restore|All projects are up-to-date for restore|Restored \S+ \()/, // dotnet restore
  /^\s+- (Downloading|Installing|Upgrading|Locking) \S+ \(/, // Composer
  /^(Fetching|Installing) \S+ \d[\w.]*( \(.*\))?$/, // Bundler
  // Docker
  /^#\d+ (sha256:|extracting |resolve |transferring |\[internal\] load|DONE \d|CACHED$|naming to |writing image |exporting )/, // BuildKit
  /^ ---> (Running in \w+|[0-9a-f]{12})$/, // legacy docker build
  /^Removing intermediate container \w+$/,
];

export const installLogs: OutputStrategy = {
  id: "install-logs",
  title: "Condense install & build logs",
  description:
    "Drops download/progress chatter from npm, pip, cargo, apt, Maven, Gradle, dotnet restore, Composer, Bundler and docker build, and shows repeated warnings once with a count. Errors stay.",
  group: "Condense noisy output",
  defaultState: "on",
  applies: isShell,
  apply: (text) => {
    const lines = text.split("\n");
    let dropped = 0;
    const warnCount = new Map<string, number>();
    for (const line of lines) if (/\bwarn(ing)?\b/i.test(line)) warnCount.set(line, (warnCount.get(line) ?? 0) + 1);
    const seenWarn = new Set<string>();
    const out: string[] = [];
    for (const line of lines) {
      if (INSTALL_NOISE.some((re) => re.test(line))) {
        dropped++;
        continue;
      }
      const n = warnCount.get(line) ?? 0;
      if (n > 1) {
        if (seenWarn.has(line)) {
          dropped++;
          continue;
        }
        seenWarn.add(line);
        out.push(`${line}  (×${n})`);
        continue;
      }
      out.push(line);
    }
    if (dropped < MIN_DROPPED) return text;
    return [`${NOTE} ${dropped} install/build log lines omitted.`, ...out].join("\n");
  },
};
