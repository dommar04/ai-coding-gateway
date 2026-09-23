import { isShell, isMcp, type OutputStrategy } from "./shared";

const FRAMEWORK_FRAME = [
  // Node.js
  /^\s+at .*(node_modules|node:internal|\(internal\/|<anonymous>)/,
  // Python
  /^\s+File ".*(site-packages|dist-packages|\/lib\/python\d)/,
  // Java / Kotlin: JDK, reflection, Spring, test runners, servers, proxies
  /^\s+at (java\.|javax\.|jakarta\.|jdk\.|sun\.|com\.sun\.|kotlin\.|kotlinx\.|org\.springframework\.|org\.junit\.|junit\.|org\.apache\.(maven|catalina|tomcat|coyote)\.|org\.hibernate\.|io\.netty\.|reactor\.|org\.gradle\.|worker\.org\.gradle\.|org\.mockito\.|net\.bytebuddy\.|org\.eclipse\.jetty\.|io\.undertow\.|com\.zaxxer\.|org\.aspectj\.)/,
  /^\s+at \S+\$\$(SpringCGLIB|EnhancerBySpringCGLIB|FastClassBySpringCGLIB)\$\$/, // Spring proxies
  /^\s+\.\.\. \d+ more$/, // "... 42 more" (frames shared with the enclosing trace)
  // .NET
  /^\s+at (System\.|Microsoft\.|Xunit\.|NUnit\.|Castle\.Proxies\.)/,
  // Go (the function line; its "\t/path/file.go:123" line is folded with it)
  /^(runtime|testing|reflect|internal\/[\w/]+|net\/http)\.[\w.()*]+\(/,
];

/** Location line that belongs to the frame above it (Go: "\t/usr/local/go/src/runtime/proc.go:381 +0x..."). */
const FRAME_LOCATION = /^\t\S+\.go:\d+( \+0x[0-9a-f]+)?$/;

export const stackTraces: OutputStrategy = {
  id: "stack-traces",
  title: "Fold framework stack frames",
  description:
    "Collapses consecutive framework stack frames into one line: node_modules and Node internals, Python site-packages, Java (JDK, Spring, JUnit, Tomcat, …), .NET and the Go runtime. Your own frames stay.",
  group: "Condense noisy output",
  defaultState: "on",
  applies: (t) => isShell(t) || isMcp(t),
  apply: (text) => {
    const lines = text.split("\n");
    const out: string[] = [];
    for (let i = 0; i < lines.length;) {
      if (FRAMEWORK_FRAME.some((re) => re.test(lines[i]))) {
        let j = i;
        while (j < lines.length) {
          if (FRAMEWORK_FRAME.some((re) => re.test(lines[j]))) j++;
          // Python frames are followed by an indented source line, Go frames by a location line.
          else if (/^\s{4,}\S/.test(lines[j]) && /^\s+File "/.test(lines[j - 1] ?? "")) j++;
          else if (FRAME_LOCATION.test(lines[j]) && FRAMEWORK_FRAME.some((re) => re.test(lines[j - 1] ?? ""))) j++;
          else break;
        }
        const frames = lines.slice(i, j).filter((l) => FRAMEWORK_FRAME.some((re) => re.test(l))).length;
        if (frames >= 3) {
          const indent = /^\s*/.exec(lines[i])![0];
          out.push(`${indent}⋯ ${frames} framework frames`);
        } else {
          out.push(...lines.slice(i, j));
        }
        i = j;
      } else {
        out.push(lines[i++]);
      }
    }
    return out.join("\n");
  },
};
