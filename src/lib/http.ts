// HUMAN-OWNED (M1), written by Claude at Andrew's request. SPEC §8.1. Tests: src/lib/http.test.ts
import { z } from "zod";
import { err, ok, type Result } from "./result.js";

// Every way a tool call can fail, as data. The runner (M6) decides retry / rephrase / transfer from `kind`.
export type ToolError =
  | { kind: "timeout" } // every attempt hit timeoutMs
  | { kind: "network"; message: string } // fetch threw (DNS, connection reset, ...)
  | { kind: "auth"; status: number } // 401 / 403
  | { kind: "not_found" } // 404
  | { kind: "http"; status: number; code?: string } // any other non-2xx; `code` from an { error: { code } } body
  | { kind: "invalid_response"; message: string } // 2xx body not JSON or failed the zod schema
  | { kind: "not_owner" } // produced by tools in M3, never by request()
  | { kind: "graphql"; code: string; path?: Array<string | number>; message: string };

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export type RequestOptions<T> = {
  url: string;
  method?: "GET" | "POST" | "PATCH"; // default "GET"
  headers?: Record<string, string>;
  body?: unknown; // JSON-serialized when present
  schema: z.ZodType<T>; // validates the 2xx response body
  idempotent?: boolean; // non-GET requests are retried only when true; GET is always retry-eligible
  timeoutMs?: number; // per attempt, default 5000
  maxAttempts?: number; // total attempts including the first, default 3
  baseDelayMs?: number; // backoff base, default 200
  maxDelayMs?: number; // backoff cap, default 5000
  signal?: AbortSignal; // caller cancel: rethrow it, never retry, never turn it into a ToolError
  fetchImpl?: typeof fetch; // default globalThis.fetch
  sleep?: Sleep; // default setTimeout-based
  random?: () => number; // [0, 1), default Math.random; injected by tests to pin jitter
};

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

// Resolves after `ms`, or rejects early with the abort reason if the caller hangs up mid-backoff.
const defaultSleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });

// Result of one attempt: either final, or retryable with an optional server-requested delay.
type Attempt<T> =
  | { kind: "done"; result: Result<T, ToolError> }
  | { kind: "retryable"; error: ToolError; retryAfterMs: number | null };

const ErrorBody = z.object({ error: z.object({ code: z.string() }) });

// Only the delta-seconds form of Retry-After; an HTTP-date falls back to jitter.
function parseRetryAfter(headers: Headers): number | null {
  const raw = headers.get("retry-after");
  if (raw === null) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

async function readErrorCode(res: Response): Promise<string | undefined> {
  const body: unknown = await res.json().catch(() => null);
  const parsed = ErrorBody.safeParse(body);
  return parsed.success ? parsed.data.error.code : undefined;
}

async function attemptOnce<T>(
  opts: RequestOptions<T>,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Attempt<T>> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal;
  const hasBody = opts.body !== undefined;

  let res: Response;
  try {
    res = await fetchImpl(opts.url, {
      method: opts.method ?? "GET",
      headers: { ...(hasBody ? { "content-type": "application/json" } : {}), ...opts.headers },
      body: hasBody ? JSON.stringify(opts.body) : undefined,
      signal,
    });
  } catch (e) {
    // The caller hanging up is not a tool failure: propagate it untouched.
    if (opts.signal?.aborted) throw opts.signal.reason;
    if (timeoutSignal.aborted) return { kind: "retryable", error: { kind: "timeout" }, retryAfterMs: null };
    const message = e instanceof Error ? e.message : String(e);
    return { kind: "retryable", error: { kind: "network", message }, retryAfterMs: null };
  }

  if (res.ok) {
    const body: unknown = await res.json().catch(() => undefined);
    const parsed = opts.schema.safeParse(body);
    const result: Result<T, ToolError> = parsed.success
      ? ok(parsed.data)
      : err({ kind: "invalid_response", message: body === undefined ? "body is not JSON" : parsed.error.message });
    return { kind: "done", result };
  }

  if (res.status === 401 || res.status === 403) return { kind: "done", result: err({ kind: "auth", status: res.status }) };
  if (res.status === 404) return { kind: "done", result: err({ kind: "not_found" }) };

  const code = await readErrorCode(res);
  const error: ToolError = code === undefined ? { kind: "http", status: res.status } : { kind: "http", status: res.status, code };
  if (!RETRYABLE_STATUSES.has(res.status)) return { kind: "done", result: err(error) };
  return { kind: "retryable", error, retryAfterMs: parseRetryAfter(res.headers) };
}

// Retry policy (the tests pin these numbers):
// - Retry-eligible requests (GET, or idempotent: true) retry on 429/502/503/504, timeout, and network errors.
// - Delay before retry n (n = 1, 2, ...):
//     Retry-After present → seconds * 1000, no jitter (give up instead if it exceeds maxDelayMs:
//                           on a live call, a long silence is worse than a clean failure)
//     otherwise           → full jitter: floor(random() * min(maxDelayMs, baseDelayMs * 2^(n-1)))
export async function request<T>(opts: RequestOptions<T>): Promise<Result<T, ToolError>> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const baseDelayMs = opts.baseDelayMs ?? 200;
  const maxDelayMs = opts.maxDelayMs ?? 5_000;
  // Retrying a non-idempotent POST could charge a customer twice, so it gets exactly one attempt.
  const retryEligible = (opts.method ?? "GET") === "GET" || opts.idempotent === true;
  const maxAttempts = retryEligible ? (opts.maxAttempts ?? 3) : 1;

  if (opts.signal?.aborted) throw opts.signal.reason;

  let lastError: ToolError = { kind: "network", message: "no attempt made" };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const outcome = await attemptOnce(opts, fetchImpl, timeoutMs);
    if (outcome.kind === "done") return outcome.result;

    lastError = outcome.error;
    if (attempt === maxAttempts) break;

    const { retryAfterMs } = outcome;
    if (retryAfterMs !== null && retryAfterMs > maxDelayMs) break;
    const delay = retryAfterMs ?? Math.floor(random() * Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)));
    await sleep(delay, opts.signal);
  }
  return err(lastError);
}

export type GraphQLErrorItem = {
  message: string;
  path?: Array<string | number>;
  extensions?: { code?: string };
};

// Partial success is still a success: the caller gets the data AND the error list and decides.
export type GraphQLData<T> = { data: T; errors: GraphQLErrorItem[] };

export type GraphQLRequestOptions<T> = Omit<RequestOptions<T>, "method" | "body" | "schema" | "idempotent"> & {
  query: string;
  variables?: Record<string, unknown>;
  dataSchema: z.ZodType<T>; // validates `data` (nullable nested fields must be nullable here)
};

// The transport envelope only; `data` stays unknown until dataSchema checks it.
const GraphQLEnvelope = z.object({
  data: z.unknown().optional(),
  errors: z
    .array(
      z.object({
        message: z.string(),
        path: z.array(z.union([z.string(), z.number()])).optional(),
        extensions: z.object({ code: z.string().optional() }).optional(),
      }),
    )
    .optional(),
});

// Real GraphQL returns HTTP 200 with an `errors` array for application errors:
//   data null/absent + errors → err { kind: "graphql", ... } from errors[0]
//   data present             → validate with dataSchema → ok({ data, errors })
// Classify by extensions.code, never by message text.
export async function graphqlRequest<T>(
  opts: GraphQLRequestOptions<T>,
): Promise<Result<GraphQLData<T>, ToolError>> {
  const { query, variables, dataSchema, ...rest } = opts;
  // Queries are side-effect free, so they are safe to retry. A mutation would need idempotent: false.
  const res = await request({ ...rest, method: "POST", body: { query, variables }, schema: GraphQLEnvelope, idempotent: true });
  if (!res.ok) return res;

  const errors: GraphQLErrorItem[] = res.data.errors ?? [];
  if (res.data.data === null || res.data.data === undefined) {
    const first = errors[0];
    return err({
      kind: "graphql",
      code: first?.extensions?.code ?? "UNKNOWN",
      ...(first?.path ? { path: first.path } : {}),
      message: first?.message ?? "response had neither data nor errors",
    });
  }

  const parsed = dataSchema.safeParse(res.data.data);
  if (!parsed.success) return err({ kind: "invalid_response", message: parsed.error.message });
  return ok({ data: parsed.data, errors });
}
