import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  getCall,
  getPromptGroup,
  lastCallId,
  listCallsCompletedSince,
  listCallsForPrompt,
  listCallsSince,
  listProjects,
  listPromptGroups,
  listRecentCalls,
  tokenTotals,
  type PromptGroupRow,
  type ToolCallRow,
} from "../storage/tables/tool-calls";
import { countEnabledRules, getRule } from "../storage/tables/tool-rules";
import { summarizeInput } from "../helpers/summary";
import { promptInfo } from "../integrations/claude/transcript";
import { listStrategies, setStrategyState } from "../services/reduction/options";
import type { StrategyState } from "../services/reduction/strategies";
import { callFromRuleSyntax } from "../services/tool-security/matching/pattern";
import {
  defaultsStatus,
  exportRules,
  formatRuleFile,
  importRules,
  resetToDefaults,
} from "../services/tool-security/rule-files/rule-sets";
import type { Verdict } from "../services/tool-security/matching/engine";
import { parseJsonList, parseJsonOrText } from "../helpers/json";
import { MODES, PolicyLockedError, getMode, getPolicySource, setMode, type Mode } from "../services/settings";
import {
  approveRequest,
  countPendingRequests,
  getRequest,
  listRequests,
  rejectRequest,
  type RequestRow,
} from "../services/tool-security/requests";
import { addRule, evaluateCall, listRules, removeRule, setRuleEnabled } from "../services/tool-security/rules";

// Local-only dashboard. It can change policy, so every API call needs the per-run token
// (blocks other websites from calling it) and a localhost Host header (blocks DNS rebinding).

export interface DashboardOptions {
  port: number;
  /** Try the next ports if `port` is taken. */
  portFallback?: boolean;
  token?: string;
  pollMs?: number;
}

export interface Dashboard {
  server: Server;
  port: number;
  token: string;
  url: string;
  close(): Promise<void>;
}

const RESULT_PREVIEW = 2000;
const MAX_BODY = 64 * 1024;
/** Rule files can hold a few thousand rules. */
const IMPORT_MAX_BODY = 2 * 1024 * 1024;

class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/** Why a call got its decision: the matching rule (deny, or the allow rule that covered it) or the approval request. */
function decisionReason(row: ToolCallRow) {
  if (row.rule_id !== null) {
    const rule = getRule(row.rule_id);
    return {
      kind: "rule",
      ruleId: row.rule_id,
      effect: rule?.effect ?? null,
      rule: rule?.rule ?? null,
      note: rule?.note ?? null,
      deleted: !rule,
    };
  }
  if (row.request_id !== null) {
    return { kind: "unlisted", requestId: row.request_id, requestStatus: getRequest(row.request_id)?.status ?? null };
  }
  return null;
}

function toCall(row: ToolCallRow, full = false) {
  let result: unknown = parseJsonOrText(row.tool_result);
  if (!full && typeof row.tool_result === "string" && row.tool_result.length > RESULT_PREVIEW) {
    result = row.tool_result.slice(0, RESULT_PREVIEW) + "…";
  }
  return {
    id: row.id,
    toolUseId: row.tool_use_id,
    sessionId: row.session_id,
    project: row.project,
    tool: row.tool_name,
    summary: summarizeInput(row.tool_input),
    decision: row.decision,
    ruleId: row.rule_id,
    requestId: row.request_id,
    reason: decisionReason(row),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    promptId: row.prompt_id,
    agentId: row.agent_id,
    durationMs: row.duration_ms,
    tokens: {
      input: row.input_tokens,
      result: row.result_tokens,
      resultAfter: row.result_tokens_after,
      potential: row.saved_potential,
    },
    reduction: parseJsonOrText(row.reduction),
    inputRewrite: parseJsonOrText(row.input_rewrite),
    reduced: row.reduced_result !== null,
    ...(full ? { input: parseJsonOrText(row.tool_input), result, reducedResult: parseJsonOrText(row.reduced_result) } : {}),
  };
}

// ---------- prompt groups ----------

function toPrompt(row: PromptGroupRow) {
  const info = promptInfo(row.transcript_path, row.prompt_id);
  return {
    promptId: row.prompt_id,
    sessionId: row.session_id,
    project: row.project,
    text: info?.text ?? null,
    at: info?.at ?? row.first_at,
    lastAt: row.last_at,
    callCount: row.calls,
    denied: row.denied,
    wouldDeny: row.would_deny,
    tokens: { input: row.input_tokens, result: row.result_tokens, saved: row.saved_tokens, potential: row.potential_tokens },
    usage: info?.usage ?? null,
    calls: listCallsForPrompt(row.prompt_id).map((c) => toCall(c)),
  };
}

function toRequest(row: RequestRow) {
  return {
    id: row.id,
    tool: row.tool_name,
    subject: row.subject,
    uncovered: parseJsonList(row.uncovered),
    suggestedExact: parseJsonList(row.suggested_exact),
    suggestedBroad: parseJsonList(row.suggested_broad),
    project: row.project,
    sessionId: row.session_id,
    status: row.status,
    hitCount: row.hit_count,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    ruleIds: parseJsonList(row.rule_ids).map(Number),
  };
}

function toVerdict(v: Verdict) {
  const ref = (r: { id: number; rule: string; note: string | null } | null) =>
    r ? { id: r.id, rule: r.rule, note: r.note } : null;
  return {
    decision: v.decision,
    reason: v.decision === "deny" ? v.reason : null,
    rule: v.decision === "deny" && v.reason === "rule" ? ref(v.rule) : null,
    matched: v.decision === "deny" && v.reason === "rule" ? v.matched : null,
    parts: v.parts.map((p) => ({ part: p.part, allowedBy: ref(p.allowedBy) })),
  };
}

function stats() {
  return {
    mode: getMode(),
    policySource: getPolicySource(),
    pendingRequests: countPendingRequests(),
    activeRules: countEnabledRules(),
    tokens: tokenTotals(),
  };
}

function readBody(req: IncomingMessage, maxBody = MAX_BODY): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBody) {
        reject(new HttpError(413, "Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolve(parsed && typeof parsed === "object" ? parsed : {});
      } catch {
        reject(new HttpError(400, "Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function tokensEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function parseIdParam(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, `Invalid id "${value}"`);
  return id;
}

// ---------- static files ----------

const PUBLIC_DIR = join(__dirname, "public");
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
};
/** No inline scripts or styles anywhere: everything comes from the files below. */
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Only these paths are served: the page, its stylesheet, its modules and the logos. */
function staticFile(pathname: string): { type: string; body: Buffer } | null {
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!/^(index\.html|styles\.css|js\/[\w-]+\.js|assets\/[\w-]+\.png)$/.test(rel)) return null;
  const file = join(PUBLIC_DIR, rel);
  if (!existsSync(file)) return null;
  return { type: CONTENT_TYPES[rel.slice(rel.lastIndexOf("."))], body: readFileSync(file) };
}

export function openBrowser(url: string): void {
  try {
    const [cmd, args] =
      process.platform === "win32"
        ? ["explorer.exe", [url]]
        : process.platform === "darwin"
          ? ["open", [url]]
          : ["xdg-open", [url]];
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Not fatal: the URL is printed as well.
  }
}

export async function startDashboard(options: DashboardOptions): Promise<Dashboard> {
  const token = options.token ?? randomBytes(18).toString("base64url");
  let port = options.port;

  // ---------- live feed: one poller for all SSE clients ----------
  const clients = new Set<ServerResponse>();
  let lastId = lastCallId();
  let lastCompleted = new Date().toISOString();
  let lastStats = "";

  const broadcast = (event: string, data: unknown) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) client.write(payload);
  };

  const poll = () => {
    try {
      const fresh = listCallsSince(lastId);
      if (fresh.length) lastId = fresh[fresh.length - 1].id;
      const completed = listCallsCompletedSince(lastCompleted);
      if (completed.length) lastCompleted = completed[completed.length - 1].completed_at ?? lastCompleted;

      const byId = new Map<number, ToolCallRow>();
      for (const row of [...fresh, ...completed]) byId.set(row.id, row);
      if (byId.size && clients.size)
        broadcast(
          "calls",
          [...byId.values()].map((r) => toCall(r))
        );

      const s = JSON.stringify(stats());
      if (s !== lastStats) {
        lastStats = s;
        broadcast("stats", JSON.parse(s));
      }
    } catch {
      // Transient DB errors (locked) are retried on the next tick.
    }
  };
  const pollTimer = setInterval(poll, options.pollMs ?? 1000);
  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(": ping\n\n");
  }, 15000);

  // ---------- routing ----------
  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const method = req.method ?? "GET";
    const path = url.pathname;
    let m: RegExpMatchArray | null;

    if (method === "GET" && path === "/api/stream") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      });
      res.write(`event: stats\ndata: ${JSON.stringify(stats())}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    if (method === "GET" && path === "/api/stats") return sendJson(res, 200, stats());
    if (method === "GET" && path === "/api/projects") return sendJson(res, 200, listProjects());
    if (method === "GET" && path === "/api/tokens")
      return sendJson(res, 200, tokenTotals(url.searchParams.get("project") || undefined));

    if (method === "GET" && path === "/api/prompts") {
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 40, 1), 200);
      return sendJson(res, 200, listPromptGroups(limit, url.searchParams.get("project") || undefined).map(toPrompt));
    }
    if (method === "GET" && (m = path.match(/^\/api\/prompts\/([\w-]+)$/))) {
      const group = getPromptGroup(m[1]);
      if (!group) throw new HttpError(404, "Prompt not found");
      return sendJson(res, 200, toPrompt(group));
    }

    if (method === "GET" && path === "/api/reduction") {
      return sendJson(res, 200, { strategies: listStrategies(), totals: tokenTotals() });
    }
    if (method === "PUT" && (m = path.match(/^\/api\/reduction\/([\w-]+)$/))) {
      const body = await readBody(req);
      if (typeof body.state !== "string") throw new HttpError(400, 'Expected { state: "on" | "measure" | "off" }');
      setStrategyState(m[1], body.state as StrategyState);
      return sendJson(res, 200, { id: m[1], state: body.state });
    }

    if (method === "GET" && path === "/api/calls") {
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 200, 1), 2000);
      return sendJson(
        res,
        200,
        listRecentCalls(limit, url.searchParams.get("project") || undefined).map((r) => toCall(r))
      );
    }
    if (method === "GET" && (m = path.match(/^\/api\/calls\/(\d+)$/))) {
      const row = getCall(parseIdParam(m[1]));
      if (!row) throw new HttpError(404, "Tool call not found");
      return sendJson(res, 200, toCall(row, true));
    }

    if (method === "GET" && path === "/api/rules/export") {
      const date = new Date().toISOString().slice(0, 10);
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="apichap-gateway-rules-${date}.json"`,
        "Cache-Control": "no-store",
      });
      res.end(formatRuleFile(exportRules()));
      return;
    }
    if (method === "POST" && path === "/api/rules/import") {
      const body = await readBody(req, IMPORT_MAX_BODY);
      const mode = body.mode === "merge" ? "merge" : "replace";
      return sendJson(res, 200, importRules(body.file, mode));
    }
    if (method === "GET" && path === "/api/rules/defaults") return sendJson(res, 200, defaultsStatus());
    if (method === "POST" && path === "/api/rules/reset") {
      const body = await readBody(req);
      return sendJson(res, 200, resetToDefaults(body.mode === "merge" ? "merge" : "replace"));
    }
    if (method === "GET" && path === "/api/rules") return sendJson(res, 200, listRules());
    if (method === "POST" && path === "/api/rules") {
      const body = await readBody(req);
      const effect = body.effect;
      const rule = typeof body.rule === "string" ? body.rule.trim() : "";
      if ((effect !== "allow" && effect !== "deny") || !rule) {
        throw new HttpError(400, 'Expected { effect: "allow" | "deny", rule: "Tool(pattern)", note? }');
      }
      const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;
      return sendJson(res, 201, { id: addRule(effect, rule, note, "dashboard") });
    }
    if (method === "POST" && path === "/api/rules/test") {
      const body = await readBody(req);
      if (typeof body.call !== "string" || !body.call.trim()) throw new HttpError(400, 'Expected { call: "Bash(...)" }');
      const { toolName, toolInput } = callFromRuleSyntax(body.call);
      const cwd = typeof body.cwd === "string" && body.cwd ? body.cwd : process.cwd();
      return sendJson(res, 200, toVerdict(evaluateCall(toolName, toolInput, cwd)));
    }
    if ((m = path.match(/^\/api\/rules\/(\d+)$/))) {
      const id = parseIdParam(m[1]);
      if (method === "PATCH") {
        const body = await readBody(req);
        if (typeof body.enabled !== "boolean") throw new HttpError(400, "Expected { enabled: boolean }");
        if (!setRuleEnabled(id, body.enabled)) throw new HttpError(404, "Rule not found");
        return sendJson(res, 200, { ok: true });
      }
      if (method === "DELETE") {
        if (!removeRule(id)) throw new HttpError(404, "Rule not found");
        return sendJson(res, 200, { ok: true });
      }
    }

    if (method === "GET" && path === "/api/requests") {
      const status = url.searchParams.get("status") ?? "pending";
      if (!["pending", "approved", "rejected", "all"].includes(status)) throw new HttpError(400, "Invalid status");
      return sendJson(res, 200, listRequests(status as RequestRow["status"] | "all").map(toRequest));
    }
    if (method === "POST" && (m = path.match(/^\/api\/requests\/(\d+)\/(approve|reject)$/))) {
      const id = parseIdParam(m[1]);
      if (!getRequest(id)) throw new HttpError(404, "Request not found");
      if (m[2] === "reject") {
        rejectRequest(id);
        return sendJson(res, 200, { ok: true });
      }
      const body = await readBody(req);
      const mode = body.mode ?? "exact";
      let custom: string[] | undefined;
      if (mode === "custom") {
        custom = String(body.rule ?? "")
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        if (custom.length === 0) throw new HttpError(400, "Custom approval needs at least one rule");
      } else if (mode !== "exact" && mode !== "broad") {
        throw new HttpError(400, 'mode must be "exact", "broad" or "custom"');
      }
      return sendJson(res, 200, approveRequest(id, { broad: mode === "broad", custom }));
    }

    if (path === "/api/mode") {
      if (method === "GET") return sendJson(res, 200, { mode: getMode() });
      if (method === "PUT") {
        const body = await readBody(req);
        if (!MODES.includes(body.mode as Mode)) throw new HttpError(400, `mode must be one of ${MODES.join(", ")}`);
        setMode(body.mode as Mode);
        return sendJson(res, 200, { mode: body.mode });
      }
    }

    throw new HttpError(404, "Not found");
  }

  const server = createServer(async (req, res) => {
    try {
      const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!allowedHosts.includes(req.headers.host ?? "")) throw new HttpError(403, "Forbidden host");
      const origin = req.headers.origin;
      if (origin && !allowedHosts.some((h) => origin === `http://${h}`)) throw new HttpError(403, "Forbidden origin");

      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

      // The page and its static files. No token needed: they carry no data (the page asks the API).
      const file = staticFile(url.pathname);
      if (file) {
        res.writeHead(200, {
          "Content-Type": file.type,
          "Cache-Control": "no-store",
          "Content-Security-Policy": CSP,
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(file.body);
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        // EventSource cannot send headers, so the stream alone takes the token as a query parameter.
        const given =
          (req.headers["x-gateway-token"] as string | undefined) ??
          (url.pathname === "/api/stream" ? (url.searchParams.get("token") ?? undefined) : undefined);
        if (!given || !tokensEqual(given, token)) throw new HttpError(401, "Missing or invalid token");
        await handleApi(req, res, url);
        return;
      }

      throw new HttpError(404, "Not found");
    } catch (err) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      if (err instanceof PolicyLockedError) return sendJson(res, 403, { error: err.message });
      if (err instanceof Error) return sendJson(res, 400, { error: err.message });
      sendJson(res, 500, { error: "Internal error" });
    }
  });

  const tries = options.portFallback ? 10 : 1;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE" || attempt === tries - 1) {
        clearInterval(pollTimer);
        clearInterval(heartbeat);
        throw err;
      }
      port++;
    }
  }
  const address = server.address();
  if (address && typeof address === "object") port = address.port;

  return {
    server,
    port,
    token,
    url: `http://127.0.0.1:${port}/?token=${token}`,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(pollTimer);
        clearInterval(heartbeat);
        for (const client of clients) client.end();
        clients.clear();
        server.close(() => resolve());
      }),
  };
}
