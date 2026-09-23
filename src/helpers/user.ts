import { userInfo } from "node:os";

/** The OS user name, recorded as "created by" / "decided by". */
export function currentUser(): string {
  try {
    return userInfo().username;
  } catch {
    return "unknown";
  }
}
