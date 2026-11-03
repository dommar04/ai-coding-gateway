import { getSetting, setSetting } from "../../storage/tables/settings";

// Calls to the company server (coding-gateway-service), authenticated with the developer's Supabase tokens.

export interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export function serverUrl(): string {
  return (process.env.APICHAP_GATEWAY_SERVER || getSetting("server_url") || "https://coding-gateway.dev.apichap.com").replace(
    /\/+$/,
    ""
  );
}

export function storeTokens(t: Tokens, email?: string): void {
  setSetting("auth:access_token", t.access_token);
  setSetting("auth:refresh_token", t.refresh_token);
  setSetting("auth:expires_at", String(Date.now() + t.expires_in * 1000));
  if (email) setSetting("auth:email", email);
}

function send(path: string, body: unknown, token?: string): Promise<Response> {
  return fetch(serverUrl() + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(3000),
  });
}

async function parse<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as { detail?: unknown };
  if (!res.ok) {
    const detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail ?? res.statusText);
    throw Object.assign(new Error(`Server error ${res.status}: ${detail}`), { status: res.status });
  }
  return data as T;
}

async function refresh(): Promise<string> {
  const refresh_token = getSetting("auth:refresh_token");
  if (!refresh_token) throw new Error("Not logged in. Run: apichap-gateway login");
  const t = await parse<Tokens>(await send("/client/refresh", { refresh_token }));
  storeTokens(t);
  return t.access_token;
}

/** POST JSON. With `auth`, an expired (or rejected) access token is refreshed once and the call retried. */
export async function post<T>(path: string, body: unknown, auth: boolean): Promise<T> {
  if (!auth) return parse<T>(await send(path, body));
  let token = getSetting("auth:access_token");
  let refreshed = false;
  if (!token || Number(getSetting("auth:expires_at") ?? 0) < Date.now() + 60_000) {
    token = await refresh();
    refreshed = true;
  }
  let res = await send(path, body, token);
  if (res.status === 401 && !refreshed) res = await send(path, body, await refresh());
  return parse<T>(res);
}
