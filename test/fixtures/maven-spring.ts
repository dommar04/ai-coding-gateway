// Realistic output of `mvn test` in a Spring Boot project with one failing test.

const lines = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i));

export const springLog = (i: number) =>
  `2026-09-16T10:00:0${i % 10}.123+02:00  INFO 4711 --- [demo] [           main] ${
    [
      "o.s.b.w.embedded.tomcat.TomcatWebServer  : Tomcat initialized with port 0",
      "com.zaxxer.hikari.HikariDataSource       : HikariPool-1 - Start completed.",
      "o.h.e.t.j.p.i.JtaPlatformInitiator       : HHH000489: No JTA platform available",
      "o.s.b.a.e.web.EndpointLinksResolver      : Exposing 1 endpoint(s)",
    ][i % 4]
  }`;

export const mavenSpringRun = [
  "[INFO] Scanning for projects...",
  ...lines(
    40,
    (i) =>
      `Downloading from central: https://repo.maven.apache.org/maven2/org/springframework/spring-core/6.1.${i}/spring-core-6.1.${i}.pom`
  ),
  ...lines(
    40,
    (i) =>
      `Downloaded from central: https://repo.maven.apache.org/maven2/org/springframework/spring-core/6.1.${i}/spring-core-6.1.${i}.pom (2.1 kB at 45 kB/s)`
  ),
  "Progress (1): 45/120 kB",
  "[INFO] ",
  "[INFO] -------------------------------------------------------",
  "[INFO]  T E S T S",
  "[INFO] -------------------------------------------------------",
  "[INFO] Running com.acme.shop.CartServiceTest",
  "[INFO] Tests run: 12, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.412 s - in com.acme.shop.CartServiceTest",
  "[INFO] Running com.acme.shop.OrderControllerTest",
  "",
  "  .   ____          _            __ _ _",
  " /\\\\ / ___'_ __ _ _(_)_ __  __ _ \\ \\ \\ \\",
  "( ( )\\___ | '_ | '_| | '_ \\/ _` | \\ \\ \\ \\",
  " \\\\/  ___)| |_)| | | | | || (_| |  ) ) ) )",
  "  '  |____| .__|_| |_|_| |_\\__, | / / / /",
  " =========|_|==============|___/=/_/_/_/",
  " :: Spring Boot ::                (v3.3.4)",
  "",
  ...lines(60, springLog),
  "Hibernate: select o1_0.id,o1_0.total from orders o1_0 where o1_0.id=?",
  "2026-09-16T10:00:09.001+02:00  WARN 4711 --- [demo] [           main] o.s.b.a.o.j.JpaBaseConfiguration         : spring.jpa.open-in-view is enabled by default",
  "2026-09-16T10:00:09.002+02:00  INFO 4711 --- [demo] [           main] com.acme.shop.OrderService               : created order 42",
  "[ERROR] Tests run: 3, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: 2.1 s <<< FAILURE! - in com.acme.shop.OrderControllerTest",
  "[ERROR] com.acme.shop.OrderControllerTest.createsOrder -- Time elapsed: 0.08 s <<< FAILURE!",
  "org.opentest4j.AssertionFailedError: expected: <201> but was: <400>",
  "\tat org.junit.jupiter.api.AssertionFailureBuilder.build(AssertionFailureBuilder.java:151)",
  "\tat org.junit.jupiter.api.AssertEquals.failNotEqual(AssertEquals.java:197)",
  "\tat com.acme.shop.OrderControllerTest.createsOrder(OrderControllerTest.java:57)",
  "\tat java.base/jdk.internal.reflect.DirectMethodHandleAccessor.invoke(DirectMethodHandleAccessor.java:103)",
  "\tat java.base/java.lang.reflect.Method.invoke(Method.java:580)",
  "\tat org.junit.platform.commons.util.ReflectionUtils.invokeMethod(ReflectionUtils.java:728)",
  "\tat org.springframework.test.context.junit.jupiter.SpringExtension.interceptTestMethod(SpringExtension.java:156)",
  "\tat org.apache.maven.surefire.junitplatform.JUnitPlatformProvider.invoke(JUnitPlatformProvider.java:127)",
  "\t... 41 more",
  "[INFO] ",
  "[INFO] Results:",
  "[ERROR] Failures: ",
  "[ERROR]   OrderControllerTest.createsOrder:57 expected: <201> but was: <400>",
  "[ERROR] Tests run: 15, Failures: 1, Errors: 0, Skipped: 0",
  "[INFO] BUILD FAILURE",
].join("\n");
