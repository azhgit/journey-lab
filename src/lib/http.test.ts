import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { graphqlRequest, request, type Sleep } from "./http.js";

// ---------- helpers ----------

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

// Returns each response once, in order. A call past the end fails the test loudly.
function fetchSeq(...responses: Response[]) {
  return vi.fn(async (_input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra fetch call");
    return next;
  });
}

// Never resolves on its own; rejects with the signal's reason when aborted (like real fetch).
function fetchHang() {
  return vi.fn((_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const signal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      signal?.addEventListener("abort", () => reject(signal.reason));
    });
  });
}

function sleepSpy() {
  return vi.fn<Sleep>(async () => {});
}

const Loan = z.object({ id: z.string(), status: z.string() });
const URL_LOAN = "http://mock.test/v1/loans/L1";

// ---------- request() ----------

describe("request()", () => {
  it("1. 503 then 200 on GET: retried once, sleep called once", async () => {
    const fetchImpl = fetchSeq(json(503, {}), json(200, { id: "L1", status: "current" }));
    const sleep = sleepSpy();

    const res = await request({ url: URL_LOAN, schema: Loan, fetchImpl, sleep });

    expect(res).toEqual({ ok: true, data: { id: "L1", status: "current" } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("2. 401: no retry, auth error", async () => {
    const fetchImpl = fetchSeq(json(401, { error: { code: "unauthorized", message: "bad key" } }));
    const sleep = sleepSpy();

    const res = await request({ url: URL_LOAN, schema: Loan, fetchImpl, sleep });

    expect(res).toEqual({ ok: false, error: { kind: "auth", status: 401 } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("3. 429 with Retry-After: 2 → sleeps exactly 2000ms (no jitter)", async () => {
    const fetchImpl = fetchSeq(
      json(429, { error: { code: "rate_limited", message: "slow down" } }, { "retry-after": "2" }),
      json(200, { id: "L1", status: "current" }),
    );
    const sleep = sleepSpy();

    const res = await request({ url: URL_LOAN, schema: Loan, fetchImpl, sleep, random: () => 0.5 });

    expect(res.ok).toBe(true);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0]?.[0]).toBe(2000);
  });

  it("4. every attempt exceeds timeoutMs → timeout error (GET retried until attempts run out)", async () => {
    // AbortSignal.timeout uses Node's internal timers, which vitest fake timers do not control,
    // so this uses a tiny real timeout instead.
    const fetchImpl = fetchHang();
    const sleep = sleepSpy();

    const res = await request({ url: URL_LOAN, schema: Loan, fetchImpl, sleep, timeoutMs: 20, maxAttempts: 2 });

    expect(res).toEqual({ ok: false, error: { kind: "timeout" } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("5. 200 with a missing field → invalid_response, not retried", async () => {
    const fetchImpl = fetchSeq(json(200, { id: "L1" }));
    const sleep = sleepSpy();

    const res = await request({ url: URL_LOAN, schema: Loan, fetchImpl, sleep });

    expect(res).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("6. POST without idempotent: single attempt on 503", async () => {
    const fetchImpl = fetchSeq(json(503, { error: { code: "upstream_unavailable", message: "down" } }));
    const sleep = sleepSpy();

    const res = await request({
      url: "http://mock.test/v1/payments",
      method: "POST",
      body: { loanId: "L1", amountCents: 100, linkedAccountId: "A1" },
      schema: z.object({ id: z.string() }),
      fetchImpl,
      sleep,
    });

    expect(res).toEqual({ ok: false, error: { kind: "http", status: 503, code: "upstream_unavailable" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("7. POST with idempotent: true is retried, and every attempt carries the same Idempotency-Key", async () => {
    const fetchImpl = fetchSeq(json(503, {}), json(201, { id: "P1" }));
    const sleep = sleepSpy();

    const res = await request({
      url: "http://mock.test/v1/payments",
      method: "POST",
      headers: { "Idempotency-Key": "quote-abc" },
      body: { loanId: "L1", amountCents: 100, linkedAccountId: "A1" },
      schema: z.object({ id: z.string() }),
      idempotent: true,
      fetchImpl,
      sleep,
    });

    expect(res).toEqual({ ok: true, data: { id: "P1" } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const keys = fetchImpl.mock.calls.map(([, init]) => new Headers(init?.headers).get("idempotency-key"));
    expect(keys).toEqual(["quote-abc", "quote-abc"]);
  });

  it("8. caller aborts: the promise rejects (not a ToolError) and nothing is retried", async () => {
    const fetchImpl = fetchHang();
    const sleep = sleepSpy();
    const controller = new AbortController();

    const pending = request({ url: URL_LOAN, schema: Loan, fetchImpl, sleep, signal: controller.signal });
    setTimeout(() => controller.abort(), 10);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  // ---- extras: these pin behavior the M3 tools depend on ----

  it("extra: full jitter backoff uses random() * min(cap, base * 2^(n-1))", async () => {
    const fetchImpl = fetchSeq(json(503, {}), json(503, {}), json(503, {}), json(200, { id: "L1", status: "current" }));
    const sleep = sleepSpy();

    await request({ url: URL_LOAN, schema: Loan, fetchImpl, sleep, random: () => 0.5, baseDelayMs: 200, maxAttempts: 4 });

    expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 200, 400]);
  });

  it("extra: Retry-After longer than maxDelayMs → give up now instead of going silent on a live call", async () => {
    const fetchImpl = fetchSeq(json(429, { error: { code: "rate_limited", message: "later" } }, { "retry-after": "60" }));
    const sleep = sleepSpy();

    const res = await request({ url: URL_LOAN, schema: Loan, fetchImpl, sleep });

    expect(res).toEqual({ ok: false, error: { kind: "http", status: 429, code: "rate_limited" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("extra: retries exhausted → the last http error is returned", async () => {
    const fetchImpl = fetchSeq(json(503, {}), json(503, {}), json(503, {}));
    const sleep = sleepSpy();

    const res = await request({ url: URL_LOAN, schema: Loan, fetchImpl, sleep });

    expect(res).toMatchObject({ ok: false, error: { kind: "http", status: 503 } });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("extra: 404 → not_found", async () => {
    const fetchImpl = fetchSeq(json(404, { error: { code: "not_found", message: "no loan" } }));

    const res = await request({ url: URL_LOAN, schema: Loan, fetchImpl, sleep: sleepSpy() });

    expect(res).toEqual({ ok: false, error: { kind: "not_found" } });
  });

  it("extra: business error code is read from the { error: { code } } body", async () => {
    const fetchImpl = fetchSeq(json(402, { error: { code: "payment_declined", message: "declined" } }));

    const res = await request({
      url: "http://mock.test/v1/payments",
      method: "POST",
      schema: z.object({ id: z.string() }),
      fetchImpl,
      sleep: sleepSpy(),
    });

    expect(res).toEqual({ ok: false, error: { kind: "http", status: 402, code: "payment_declined" } });
  });

  it("extra: fetch throwing (connection refused) → network error", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      throw new TypeError("fetch failed");
    });

    const res = await request({ url: URL_LOAN, schema: Loan, fetchImpl, sleep: sleepSpy(), maxAttempts: 1 });

    expect(res).toMatchObject({ ok: false, error: { kind: "network" } });
  });

  it("extra: sends a JSON body with content-type", async () => {
    const fetchImpl = fetchSeq(json(201, { id: "P1" }));

    await request({
      url: "http://mock.test/v1/payments",
      method: "POST",
      body: { a: 1 },
      schema: z.object({ id: z.string() }),
      fetchImpl,
      sleep: sleepSpy(),
    });

    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ a: 1 }));
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });
});

// ---------- graphqlRequest() ----------

const LoanDetails = z.object({
  loanDetails: z
    .object({
      id: z.string(),
      nextPayment: z.object({ amountDueCents: z.number(), dueDate: z.string() }).nullable(),
    })
    .nullable(),
});
const QUERY = "query($id: ID!) { loanDetails(id: $id) { id nextPayment { amountDueCents dueDate } } }";
const URL_GQL = "http://mock.test/graphql";

describe("graphqlRequest()", () => {
  it("9. 200 with errors and null data → graphql error classified by extensions.code", async () => {
    const fetchImpl = fetchSeq(
      json(200, {
        data: null,
        errors: [{ message: "Loan not found", path: ["loanDetails"], extensions: { code: "NOT_FOUND" } }],
      }),
    );

    const res = await graphqlRequest({
      url: URL_GQL,
      query: QUERY,
      variables: { id: "L404" },
      dataSchema: LoanDetails,
      fetchImpl,
      sleep: sleepSpy(),
    });

    expect(res).toEqual({
      ok: false,
      error: { kind: "graphql", code: "NOT_FOUND", path: ["loanDetails"], message: "Loan not found" },
    });
  });

  it("10. partial data: returns data plus the error list so the caller decides", async () => {
    const partialError = {
      message: "payments service unavailable",
      path: ["loanDetails", "nextPayment"],
      extensions: { code: "UPSTREAM_UNAVAILABLE" },
    };
    const fetchImpl = fetchSeq(json(200, { data: { loanDetails: { id: "L1", nextPayment: null } }, errors: [partialError] }));

    const res = await graphqlRequest({ url: URL_GQL, query: QUERY, variables: { id: "L1" }, dataSchema: LoanDetails, fetchImpl, sleep: sleepSpy() });

    expect(res).toEqual({
      ok: true,
      data: { data: { loanDetails: { id: "L1", nextPayment: null } }, errors: [partialError] },
    });
  });

  it("extra: classifies by extensions.code, never by message text", async () => {
    const fetchImpl = fetchSeq(
      json(200, { data: null, errors: [{ message: "Not found (really forbidden)", extensions: { code: "FORBIDDEN" } }] }),
    );

    const res = await graphqlRequest({ url: URL_GQL, query: QUERY, dataSchema: LoanDetails, fetchImpl, sleep: sleepSpy() });

    expect(res).toMatchObject({ ok: false, error: { kind: "graphql", code: "FORBIDDEN" } });
  });

  it("extra: missing extensions.code → UNKNOWN", async () => {
    const fetchImpl = fetchSeq(json(200, { data: null, errors: [{ message: "weird" }] }));

    const res = await graphqlRequest({ url: URL_GQL, query: QUERY, dataSchema: LoanDetails, fetchImpl, sleep: sleepSpy() });

    expect(res).toMatchObject({ ok: false, error: { kind: "graphql", code: "UNKNOWN" } });
  });

  it("extra: clean response → ok with an empty error list", async () => {
    const data = { loanDetails: { id: "L1", nextPayment: { amountDueCents: 21450, dueDate: "2026-11-14" } } };
    const fetchImpl = fetchSeq(json(200, { data }));

    const res = await graphqlRequest({ url: URL_GQL, query: QUERY, dataSchema: LoanDetails, fetchImpl, sleep: sleepSpy() });

    expect(res).toEqual({ ok: true, data: { data, errors: [] } });
  });

  it("extra: POSTs { query, variables } and is retried as a side-effect-free query", async () => {
    const data = { loanDetails: null };
    const fetchImpl = fetchSeq(json(503, {}), json(200, { data }));

    const res = await graphqlRequest({ url: URL_GQL, query: QUERY, variables: { id: "L1" }, dataSchema: LoanDetails, fetchImpl, sleep: sleepSpy() });

    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ query: QUERY, variables: { id: "L1" } });
  });
});
