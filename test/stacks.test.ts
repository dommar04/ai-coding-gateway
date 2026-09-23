import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OUTPUT_STRATEGIES, type OutputContext, type StrategyState } from "../src/services/reduction/strategies";
import { reduceResult } from "../src/services/reduction/pipeline";
import { mavenSpringRun, springLog } from "./fixtures/maven-spring";

// Realistic output from other tech stacks: what must disappear, and what must survive.

const spillDir = mkdtempSync(join(tmpdir(), "apichap-stacks-"));
const ctx: OutputContext = { toolName: "Bash", toolInput: {}, field: "stdout", toolUseId: "t", dryRun: true, spillDir };
const run = (id: string, text: string) => OUTPUT_STRATEGIES.find((s) => s.id === id)!.apply(text, ctx);
const lines = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i));

// ---------- Java: Maven + Spring Boot ----------

test("Maven + Spring Boot: failures survive, noise goes", () => {
  const states = new Map<string, StrategyState>(OUTPUT_STRATEGIES.map((s) => [s.id, "on"]));
  const r = reduceResult({
    toolName: "Bash",
    toolInput: { command: "mvn test" },
    toolResponse: { stdout: mavenSpringRun, stderr: "" },
    toolUseId: "mvn",
    states,
    spillDir,
  });
  const out = (r.response as { stdout: string }).stdout;

  // What matters is all still there.
  for (const keep of [
    "<<< FAILURE! - in com.acme.shop.OrderControllerTest",
    "expected: <201> but was: <400>",
    "at com.acme.shop.OrderControllerTest.createsOrder(OrderControllerTest.java:57)", // own frame
    "WARN 4711", // warnings stay
    "com.acme.shop.OrderService               : created order 42", // own INFO logs stay
    "OrderControllerTest.createsOrder:57",
    "[ERROR] Tests run: 15, Failures: 1",
    "BUILD FAILURE",
  ])
    assert.ok(out.includes(keep), `kept: ${keep}`);

  // The noise is gone.
  assert.doesNotMatch(out, /Downloading from central/);
  assert.doesNotMatch(out, /Progress \(1\)/);
  assert.doesNotMatch(out, /:: Spring Boot ::/);
  assert.doesNotMatch(out, /TomcatWebServer|HikariPool|JtaPlatform/);
  assert.doesNotMatch(out, /^Hibernate: /m);
  assert.doesNotMatch(out, /Tests run: 12, Failures: 0/); // passing class
  assert.doesNotMatch(out, /SpringExtension\.interceptTestMethod/);
  assert.match(out, /⋯ \d+ framework frames/);

  const saved = 1 - r.resultTokensAfter / r.resultTokens;
  assert.ok(saved > 0.8, `saved ${Math.round(saved * 100)}%`);
});

test("framework-logs keeps short output and non-framework logs untouched", () => {
  assert.equal(run("framework-logs", springLog(0)), springLog(0));
  const own = lines(40, (i) => `2026-09-16 10:00:00.000  INFO 1 --- [main] com.acme.billing.Invoice : invoice ${i}`).join("\n");
  assert.equal(run("framework-logs", own), own);
});

// ---------- Java: Gradle ----------

test("Gradle: passing tests and idle tasks go, failures stay", () => {
  const out = [
    "> Task :compileJava UP-TO-DATE",
    "> Task :processResources NO-SOURCE",
    "> Task :classes UP-TO-DATE",
    ...lines(8, (i) => `CartTest > addsItem${i}() PASSED`),
    "OrderTest > rejectsEmptyOrder() FAILED",
    "    java.lang.IllegalStateException at OrderTest.java:31",
    "> Task :test FAILED",
    "10 tests completed, 1 failed",
  ].join("\n");
  const r = run("install-logs", run("test-output", out));
  assert.match(r, /OrderTest > rejectsEmptyOrder\(\) FAILED/);
  assert.match(r, /IllegalStateException at OrderTest\.java:31/);
  assert.match(r, /> Task :test FAILED/);
  assert.match(r, /10 tests completed, 1 failed/);
  assert.doesNotMatch(r, /addsItem3\(\) PASSED/);
  assert.doesNotMatch(r, /UP-TO-DATE/);
});

// ---------- .NET ----------

test("dotnet test: passed lines go, failed stay; .NET frames fold", () => {
  const out = [
    "  Determining projects to restore...",
    "  All projects are up-to-date for restore.",
    ...lines(7, (i) => `  Passed Shop.Tests.CartTests.AddsItem${i} [3 ms]`),
    "  Failed Shop.Tests.OrderTests.RejectsEmpty [12 ms]",
    "  Error Message:",
    "   Assert.Equal() Failure: Expected 1, Actual 0",
    "  Stack Trace:",
    "     at Shop.Tests.OrderTests.RejectsEmpty() in C:\\src\\OrderTests.cs:line 21",
    "     at System.RuntimeMethodHandle.InvokeMethod(Object target, Void** arguments, Signature sig, Boolean isConstructor)",
    "     at System.Reflection.MethodBaseInvoker.InvokeWithNoArgs(Object obj, BindingFlags invokeAttr)",
    "     at Xunit.Sdk.TestInvoker`1.CallTestMethod(Object testClassInstance)",
    "Failed!  - Failed:     1, Passed:     7, Skipped:     0, Total:     8",
  ].join("\n");
  const r = run("stack-traces", run("install-logs", run("test-output", out)));
  assert.match(r, /Failed Shop\.Tests\.OrderTests\.RejectsEmpty/);
  assert.match(r, /Expected 1, Actual 0/);
  assert.match(r, /OrderTests\.cs:line 21/);
  assert.match(r, /⋯ 3 framework frames/);
  assert.match(r, /Failed!  - Failed:     1/);
  assert.doesNotMatch(r, /AddsItem4/);
});

// ---------- Go ----------

test("Go: runtime frames fold together with their location lines", () => {
  const trace = [
    "panic: runtime error: index out of range [3] with length 3",
    "",
    "goroutine 7 [running]:",
    "github.com/acme/shop.(*Cart).Item(...)",
    "\t/home/me/shop/cart.go:42",
    "testing.tRunner.func1.2({0x5a4b20, 0xc000016120})",
    "\t/usr/local/go/src/testing/testing.go:1631 +0x24a",
    "testing.tRunner.func1()",
    "\t/usr/local/go/src/testing/testing.go:1634 +0x377",
    "runtime.gopanic({0x5a4b20?, 0xc000016120?})",
    "\t/usr/local/go/src/runtime/panic.go:770 +0x132",
  ].join("\n");
  const r = run("stack-traces", trace);
  assert.match(r, /github\.com\/acme\/shop\.\(\*Cart\)\.Item/);
  assert.match(r, /cart\.go:42/);
  assert.match(r, /⋯ 3 framework frames/);
  assert.doesNotMatch(r, /testing\.go:1631/);
});

// ---------- PHP, Ruby, pytest progress ----------

test("progress-dot lines from PHPUnit, RSpec and pytest go, lines with failures stay", () => {
  const out = [
    "...............................................................  63 / 120 ( 52%)",
    "..........F....................................................  126 / 120 (100%)",
    "tests/test_cart.py ........................                     [ 40%]",
    "tests/test_order.py ....F....                                   [100%]",
    "..........................................",
    ...lines(3, () => "✔ Cart adds item"),
    "✘ Order rejects empty",
    "FAILURES!",
  ].join("\n");
  const r = run("test-output", out);
  assert.match(r, /F\.{20,}/); // PHPUnit line with a failure
  assert.match(r, /test_order\.py \.\.\.\.F/);
  assert.match(r, /✘ Order rejects empty/);
  assert.match(r, /FAILURES!/);
  assert.doesNotMatch(r, /63 \/ 120/);
  assert.doesNotMatch(r, /test_cart\.py/);
});

// ---------- Docker ----------

test("docker build: layer chatter goes, build output and errors stay", () => {
  const out = [
    "#1 [internal] load build definition from Dockerfile",
    "#1 transferring dockerfile: 512B done",
    "#2 resolve docker.io/library/node:22@sha256:abc done",
    "#3 sha256:1f2e 12.6MB / 48.3MB 0.9s",
    "#3 extracting sha256:1f2e 2.1s",
    "#3 DONE 3.2s",
    "#4 CACHED",
    "#5 [3/5] RUN npm ci",
    "#5 1.204 npm ERR! code ERESOLVE",
    '#5 ERROR: process "/bin/sh -c npm ci" did not complete successfully: exit code: 1',
  ].join("\n");
  const r = run("install-logs", out);
  assert.match(r, /npm ERR! code ERESOLVE/);
  assert.match(r, /#5 ERROR: process/);
  assert.match(r, /#5 \[3\/5\] RUN npm ci/);
  assert.doesNotMatch(r, /extracting sha256/);
  assert.doesNotMatch(r, /#4 CACHED/);
});
