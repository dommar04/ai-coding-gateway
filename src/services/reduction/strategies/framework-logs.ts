import { isShell, NOTE, type OutputStrategy } from "./shared";

// Log lines from well-known frameworks: Spring Boot (abbreviated "o.s.b..." or full logger names),
// Hibernate, Hikari, Tomcat/Catalina, Netty, Kafka, Flyway, Liquibase, Jetty, Undertow, Micrometer, Quartz.
const FRAMEWORK_LOGGER =
  /(^|[\s[(])(o\.s\.|org\.springframework\.|o\.h\.|org\.hibernate\.|c\.z\.h\.|com\.zaxxer\.|o\.a\.c\.|o\.a\.catalina|org\.apache\.(catalina|coyote|tomcat|kafka|http|zookeeper)\.|o\.a\.k\.|io\.netty\.|i\.n\.|o\.f\.|org\.flywaydb\.|liquibase\.|o\.e\.j\.|org\.eclipse\.jetty\.|io\.undertow\.|io\.micrometer\.|org\.quartz\.|o\.m\.|org\.mongodb\.driver)/;

const QUIET_LEVEL = /^.{0,80}?\b(TRACE|DEBUG|INFO)\b/;

const SPRING_BANNER = /^ {0,4}\. {2,}____ .*\n(?:.*\n){0,8}? *:: Spring Boot :: .*(?:\n|$)/m;

export const frameworkLogs: OutputStrategy = {
  id: "framework-logs",
  title: "Condense framework logs",
  description:
    "In long output, drops INFO/DEBUG/TRACE log lines from framework loggers (Spring, Hibernate, Hikari, Tomcat, Netty, Kafka, Flyway, Jetty, …), Hibernate SQL echo and the Spring Boot banner. WARN/ERROR and your own packages' logs always stay.",
  group: "Condense noisy output",
  defaultState: "measure",
  applies: isShell,
  apply: (text) => {
    const withoutBanner = text.replace(SPRING_BANNER, "");
    const lines = withoutBanner.split("\n");
    if (lines.length < 30) return text;
    let dropped = withoutBanner.length < text.length ? 1 : 0;
    const out = lines.filter((line) => {
      const noise = (QUIET_LEVEL.test(line) && FRAMEWORK_LOGGER.test(line)) || /^Hibernate: /.test(line);
      if (noise) dropped++;
      return !noise;
    });
    if (dropped < 5) return text;
    return [`${NOTE} ${dropped} framework log lines (INFO/DEBUG/TRACE, banner) omitted; warnings and errors kept.`, ...out].join(
      "\n"
    );
  },
};
