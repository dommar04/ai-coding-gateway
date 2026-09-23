import { isShell, NOTE, MIN_DROPPED, type OutputStrategy } from "./shared";

const PASS_LINE = [
  // JavaScript / TypeScript
  /^\s*(✓|✔|√)\s/, // jest, vitest, mocha, PHPUnit testdox
  /^\s*PASS\s/, // jest file summary
  /^ok \d+ - /, // TAP / node:test
  /^\s*# Subtest: /, // node:test
  // Python, Rust, Go
  /^.*::.* PASSED(\s|$)/, // pytest -v
  /^\S+\.py \.+\s+\[\s*\d+%\]$/, // pytest progress line with only passes
  /^test .* \.\.\. ok$/, // cargo test
  /^\s*--- PASS: /, // go test
  /^=== (RUN|PAUSE|CONT)\s/, // go test
  // Java / Kotlin
  /^\[INFO\] Running \S+$/, // Maven Surefire: class started
  /^\[INFO\] Tests run: \d+, Failures: 0, Errors: 0, Skipped: \d+, Time elapsed: .* - in \S+$/, // Maven: class passed
  /^\s*\S+ > .+ PASSED\s*$/, // Gradle test events
  /^[\s│├└─╷╵]*[^│├└─\s].* ✔\s*$/, // JUnit console launcher tree
  // .NET, PHP, Ruby
  /^\s*Passed\s+\S.*\[\s*[\d.]+\s*m?s\]\s*$/, // dotnet test (normal verbosity)
  /^\.+\s+\d+ \/ \d+ \(\s*\d+%\)$/, // PHPUnit progress line with only passes
  /^\.{10,}$/, // RSpec / minitest progress dots
];

export const testOutput: OutputStrategy = {
  id: "test-output",
  title: "Condense test runs",
  description:
    "Drops passing-test lines from jest, vitest, mocha, node:test/TAP, pytest, cargo, go test, Maven Surefire, Gradle, JUnit, dotnet test, PHPUnit and RSpec output. Failures and summaries stay.",
  group: "Condense noisy output",
  defaultState: "on",
  applies: isShell,
  apply: (text) => {
    const lines = text.split("\n");
    const out: string[] = [];
    let dropped = 0;
    for (let i = 0; i < lines.length; i++) {
      if (PASS_LINE.some((re) => re.test(lines[i]))) {
        dropped++;
        // TAP: an "ok" line may be followed by an indented YAML block ("  ---" ... "  ...").
        if (/^ok \d+ - /.test(lines[i]) && /^\s+---\s*$/.test(lines[i + 1] ?? "")) {
          let j = i + 2;
          while (j < lines.length && !/^\s+\.\.\.\s*$/.test(lines[j])) j++;
          i = j;
        }
        continue;
      }
      out.push(lines[i]);
    }
    if (dropped < MIN_DROPPED) return text;
    return [`${NOTE} ${dropped} passing-test lines omitted.`, ...out].join("\n");
  },
};
