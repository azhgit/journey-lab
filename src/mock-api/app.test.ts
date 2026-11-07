import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { ScenarioFlag } from "./types.js";

const KEY = "test-key";
let app: ReturnType<typeof createApp>["app"];
let store: ReturnType<typeof createApp>["store"];

beforeEach(() => {
  ({ app, store } = createApp({ apiKey: KEY, testRoutes: true, hangMs: 30, slowMs: 30 }));
});

function call(method: string, path: string, opts: { body?: unknown; headers?: Record<string, string>; session?: string } = {}) {
  return app.request(path, {
    method,
    headers: {
      "x-api-key": KEY,
      "content-type": "application/json",
      ...(opts.session ? { "x-session-id": opts.session } : {}),
      ...opts.headers,
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

async function setFlags(session: string, flags: ScenarioFlag[]) {
  const res = await call("PUT", `/__test/scenarios/${session}`, { body: { flags } });
  expect(res.status).toBe(200);
}

function pay(body: { loanId: string; amountCents: number; linkedAccountId: string }, key: string | null, session?: string) {
  return call("POST", "/v1/payments", { body, session, headers: key ? { "Idempotency-Key": key } : {} });
}

const gql = (query: string, variables: Record<string, unknown>, session?: string) =>
  call("POST", "/graphql", { body: { query, variables }, session });

const LOAN_QUERY = `query($id: ID!) { loanDetails(id: $id) { id status payoffAmountCents customer { phone }
  nextPayment { amountDueCents dueDate } autopay { enabled linkedAccount { last4 } } } }`;

describe("auth", () => {
  it("REST without x-api-key → 401", async () => {
    const res = await app.request("/v1/loans/L1001");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });
  });

  it("GraphQL without x-api-key → 200 with UNAUTHENTICATED", async () => {
    const res = await app.request("/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: LOAN_QUERY, variables: { id: "L1001" } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.errors[0].extensions.code).toBe("UNAUTHENTICATED");
  });

  it("test routes are absent unless enabled", async () => {
    const prod = createApp({ apiKey: KEY }).app;
    expect((await prod.request("/__test/last-code?phone=x")).status).toBe(404);
    expect((await prod.request("/__test/payments")).status).toBe(404);
  });
});

describe("REST loans", () => {
  it("GET /v1/loans?phone= returns that customer's loans with customer.phone", async () => {
    const res = await call("GET", "/v1/loans?phone=%2B14155550103");
    const body = await res.json();
    expect(body.map((l: { id: string }) => l.id)).toEqual(["L1003", "L1004"]);
    expect(body[0].customer.phone).toBe("+14155550103");
  });

  it("GET /v1/loans/:id → loan, and 404 shape for unknown", async () => {
    expect((await (await call("GET", "/v1/loans/L1001")).json()).nextPayment.amountDueCents).toBe(21_450);
    const res = await call("GET", "/v1/loans/NOPE");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("linked accounts expose last4 only", async () => {
    const body = await (await call("GET", "/v1/loans/L1001/linked-accounts")).json();
    expect(body).toEqual([
      { id: "A1", bankName: "First Harbor Bank", last4: "4821" },
      { id: "A2", bankName: "Cedar Credit Union", last4: "0937" },
    ]);
  });

  it("payment-options: [amountDue, payoff]; 409 for a paid-off loan", async () => {
    const body = await (await call("GET", "/v1/loans/L1001/payment-options")).json();
    expect(body).toMatchObject({ minCents: 21_450, maxCents: 845_300 });
    expect((await call("GET", "/v1/loans/L1003/payment-options")).status).toBe(409);
  });

  it("PATCH autopay: enable with an owned account, refuse someone else's", async () => {
    const ok = await call("PATCH", "/v1/loans/L1001/autopay", { body: { enabled: true, linkedAccountId: "A2" } });
    expect(await ok.json()).toEqual({ enabled: true, linkedAccountId: "A2" });
    const bad = await call("PATCH", "/v1/loans/L1001/autopay", { body: { enabled: true, linkedAccountId: "A3" } });
    expect(bad.status).toBe(403);
  });
});

describe("POST /v1/payments", () => {
  const body = { loanId: "L1001", amountCents: 21_450, linkedAccountId: "A1" };

  it("missing Idempotency-Key → 400", async () => {
    const res = await pay(body, null);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("idempotency_key_required");
  });

  it("succeeds once; replaying the key returns the original and creates no second payment", async () => {
    const first = await pay(body, "k1");
    expect(first.status).toBe(201);
    const original = await first.json();

    const replay = await pay(body, "k1");
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
    expect(await replay.json()).toEqual(original);
    expect(store.payments).toHaveLength(1);
  });

  it("same key with a different body → 422 idempotency_key_reused", async () => {
    await pay(body, "k1");
    const res = await pay({ ...body, amountCents: 30_000 }, "k1");
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("idempotency_key_reused");
  });

  it("amount outside [amountDue, payoff] → 422 invalid_amount", async () => {
    expect((await pay({ ...body, amountCents: 100 }, "low")).status).toBe(422);
    expect((await pay({ ...body, amountCents: 999_999_99 }, "high")).status).toBe(422);
    expect(store.payments).toHaveLength(0);
  });

  it("account owned by another customer → 403", async () => {
    expect((await pay({ ...body, linkedAccountId: "A3" }, "k")).status).toBe(403);
  });

  it("paying the amount due moves the schedule to the next installment, not to zero due on the old date", async () => {
    await pay(body, "k1");
    expect(store.loans.get("L1001")?.nextPayment).toEqual({ amountDueCents: 21_450, dueDate: "2026-12-14" });
    expect(store.loans.get("L1001")?.status).toBe("current");
  });

  it("paying a past-due loan's full amount due makes it current, with one installment due next month", async () => {
    await pay({ loanId: "L1002", amountCents: 43_900, linkedAccountId: "A3" }, "k1");
    expect(store.loans.get("L1002")?.status).toBe("current");
    expect(store.loans.get("L1002")?.nextPayment).toEqual({ amountDueCents: 21_950, dueDate: "2026-11-01" });
  });

  it("the last installment is capped at the payoff amount", async () => {
    const loan = store.loans.get("L1001");
    if (loan === undefined) throw new Error("seed has L1001");
    loan.payoffAmountCents = 30_000;
    await pay(body, "k1");
    expect(store.loans.get("L1001")?.nextPayment).toEqual({ amountDueCents: 8_550, dueDate: "2026-12-14" });
  });
});

describe("step-up", () => {
  it("send is 202 for a real loan and for an unknown loan (no enumeration)", async () => {
    expect((await call("POST", "/v1/step-up/send", { body: { loanId: "L1001" } })).status).toBe(202);
    expect((await call("POST", "/v1/step-up/send", { body: { loanId: "L9999" } })).status).toBe(202);
    expect(store.lastCodeByPhone.size).toBe(1);
  });

  it("the code goes to the phone on file and passes exactly once", async () => {
    await call("POST", "/v1/step-up/send", { body: { loanId: "L1001" } });
    const { code } = await (await call("GET", "/__test/last-code?phone=%2B14155550101")).json();

    const check = (c: string) => call("POST", "/v1/step-up/check", { body: { loanId: "L1001", code: c } });
    expect(await (await check("000000" === code ? "111111" : "000000")).json()).toEqual({ passed: false });
    expect(await (await check(code)).json()).toEqual({ passed: true });
    expect(await (await check(code)).json()).toEqual({ passed: false }); // single use
  });

  it("check for a loan that never got a code → passed: false", async () => {
    const res = await call("POST", "/v1/step-up/check", { body: { loanId: "L9999", code: "123456" } });
    expect(await res.json()).toEqual({ passed: false });
  });

  it("expired code fails", async () => {
    let t = 1_000;
    const timed = createApp({ apiKey: KEY, testRoutes: true, now: () => t });
    const req = (path: string, b: unknown) =>
      timed.app.request(path, { method: "POST", headers: { "x-api-key": KEY }, body: JSON.stringify(b) });
    await req("/v1/step-up/send", { loanId: "L1001" });
    const code = timed.store.lastCodeByPhone.get("+14155550101");
    t += 6 * 60_000;
    expect(await (await req("/v1/step-up/check", { loanId: "L1001", code })).json()).toEqual({ passed: false });
  });
});

describe("GraphQL", () => {
  it("loanDetails returns the SDL shape with an uppercase enum", async () => {
    const body = await (await gql(LOAN_QUERY, { id: "L1004" })).json();
    expect(body.errors).toBeUndefined();
    expect(body.data.loanDetails).toEqual({
      id: "L1004",
      status: "CURRENT",
      payoffAmountCents: 391_250,
      customer: { phone: "+14155550103" },
      nextPayment: { amountDueCents: 15_820, dueDate: "2026-11-20" },
      autopay: { enabled: true, linkedAccount: { last4: "7740" } },
    });
  });

  it("unknown loan → HTTP 200, loanDetails null, NOT_FOUND on path [loanDetails]", async () => {
    const res = await gql(LOAN_QUERY, { id: "NOPE" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ loanDetails: null });
    expect(body.errors[0]).toMatchObject({ path: ["loanDetails"], extensions: { code: "NOT_FOUND" } });
  });
});

describe("failure injection (per x-session-id)", () => {
  const body = { loanId: "L1001", amountCents: 21_450, linkedAccountId: "A1" };

  it("flags only affect their own session", async () => {
    await setFlags("s1", ["empty_loans"]);
    expect(await (await call("GET", "/v1/loans?phone=%2B14155550101", { session: "s1" })).json()).toEqual([]);
    expect(await (await call("GET", "/v1/loans?phone=%2B14155550101", { session: "s2" })).json()).toHaveLength(1);
  });

  it("payment_declined → 402 every time, payment recorded as failed", async () => {
    await setFlags("s", ["payment_declined"]);
    const res = await pay(body, "k1", "s");
    expect(res.status).toBe(402);
    expect((await res.json()).error.code).toBe("payment_declined");
    expect((await pay(body, "k2", "s")).status).toBe(402);
    expect(store.payments.map((p) => p.status)).toEqual(["failed", "failed"]);
  });

  it("payment_declined_once → first payment declined, next one (new key) succeeds", async () => {
    await setFlags("s", ["payment_declined_once"]);
    expect((await pay(body, "k1", "s")).status).toBe(402);
    expect((await pay({ ...body, linkedAccountId: "A2" }, "k2", "s")).status).toBe(201);
  });

  it("insufficient_funds → 402 insufficient_funds", async () => {
    await setFlags("s", ["insufficient_funds"]);
    expect((await (await pay(body, "k1", "s")).json()).error.code).toBe("insufficient_funds");
  });

  it("timeout → commits, hangs the first response; the replay with the same key returns it at once", async () => {
    await setFlags("s", ["timeout"]);
    const started = Date.now();
    const first = await pay(body, "k1", "s");
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
    expect(first.status).toBe(201);
    const replay = await pay(body, "k1", "s");
    expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
    expect(store.payments).toHaveLength(1);
  });

  it("flaky_503_then_ok → first hit per endpoint is 503, second is ok", async () => {
    await setFlags("s", ["flaky_503_then_ok"]);
    expect((await call("GET", "/v1/loans/L1001", { session: "s" })).status).toBe(503);
    expect((await call("GET", "/v1/loans/L1001", { session: "s" })).status).toBe(200);
    expect((await pay(body, "k1", "s")).status).toBe(503);
    expect(store.payments).toHaveLength(0); // the 503 happened before anything was committed
    expect((await pay(body, "k1", "s")).status).toBe(201);
  });

  it("rate_limited_with_retry_after → 429 with Retry-After: 1, then ok", async () => {
    await setFlags("s", ["rate_limited_with_retry_after"]);
    const res = await call("GET", "/v1/loans/L1001", { session: "s" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("1");
    expect((await call("GET", "/v1/loans/L1001", { session: "s" })).status).toBe(200);
  });

  it("past_due_account → loans read as past_due (REST and GraphQL)", async () => {
    await setFlags("s", ["past_due_account"]);
    expect((await (await call("GET", "/v1/loans/L1001", { session: "s" })).json()).status).toBe("past_due");
    expect((await (await gql(LOAN_QUERY, { id: "L1001" }, "s")).json()).data.loanDetails.status).toBe("PAST_DUE");
  });

  it("graphql_partial_error → partial data, nextPayment null, error on its path", async () => {
    await setFlags("s", ["graphql_partial_error"]);
    const res = await gql(LOAN_QUERY, { id: "L1001" }, "s");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.loanDetails.id).toBe("L1001");
    expect(body.data.loanDetails.nextPayment).toBeNull();
    expect(body.errors).toEqual([
      expect.objectContaining({ path: ["loanDetails", "nextPayment"], extensions: { code: "UPSTREAM_UNAVAILABLE" } }),
    ]);
  });

  it("sms_unavailable → step-up send 503", async () => {
    await setFlags("s", ["sms_unavailable"]);
    const res = await call("POST", "/v1/step-up/send", { body: { loanId: "L1001" }, session: "s" });
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("sms_unavailable");
  });

  it("slow_tool → response delayed by slowMs", async () => {
    await setFlags("s", ["slow_tool"]);
    const started = Date.now();
    await call("GET", "/v1/loans/L1001", { session: "s" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });

  it("unknown flag is rejected", async () => {
    const res = await call("PUT", "/__test/scenarios/s", { body: { flags: ["made_up"] } });
    expect(res.status).toBe(400);
  });
});
