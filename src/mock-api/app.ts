import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import { createGraphQL } from "./graphql.js";
import { createStore, firstHit, session, STEP_UP_MAX_CHECKS, STEP_UP_TTL_MS, type Store } from "./store.js";
import { SCENARIO_FLAGS, type Payment, type ScenarioFlag } from "./types.js";
import { loanView } from "./views.js";

export type AppOptions = {
  apiKey: string;
  store?: Store;
  testRoutes?: boolean; // exposes /__test/*; the server enables it only when NODE_ENV=test
  hangMs?: number; // how long the `timeout` flag hangs, default 30s
  slowMs?: number; // delay added by `slow_tool`, default 1200ms
  now?: () => number;
};

type Env = { Variables: { sessionId: string; flags: ReadonlySet<ScenarioFlag> } };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fail(c: Context, status: ContentfulStatusCode, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

const PaymentBody = z.object({
  loanId: z.string(),
  amountCents: z.number().int().positive(),
  linkedAccountId: z.string(),
});
const AutopayBody = z.object({ enabled: z.boolean(), linkedAccountId: z.string().nullable() });

export function createApp(opts: AppOptions) {
  const store = opts.store ?? createStore();
  const now = opts.now ?? Date.now;
  const hangMs = opts.hangMs ?? 30_000;
  const slowMs = opts.slowMs ?? 1_200;
  const yoga = createGraphQL(store);
  const app = new Hono<Env>();

  // ---- test-only control plane ----
  if (opts.testRoutes) {
    app.put("/__test/scenarios/:sessionId", async (c) => {
      const parsed = z.object({ flags: z.array(z.enum(SCENARIO_FLAGS)) }).safeParse(await c.req.json());
      if (!parsed.success) return fail(c, 400, "invalid_request", parsed.error.message);
      const s = session(store, c.req.param("sessionId"));
      s.flags = new Set(parsed.data.flags);
      s.hits.clear();
      return c.json({ sessionId: c.req.param("sessionId"), flags: parsed.data.flags });
    });
    app.get("/__test/last-code", (c) => {
      const code = store.lastCodeByPhone.get(c.req.query("phone") ?? "");
      return code ? c.json({ code }) : fail(c, 404, "not_found", "no code sent to that phone");
    });
    app.get("/__test/payments", (c) => {
      const loanId = c.req.query("loanId");
      return c.json(store.payments.filter((p) => !loanId || p.loanId === loanId));
    });
  }

  // ---- auth + session + failure injection for the real API surface ----
  for (const path of ["/v1/*", "/graphql"]) {
    app.use(path, async (c, next) => {
      if (c.req.header("x-api-key") !== opts.apiKey) {
        // GraphQL convention: HTTP 200 with an errors array, not a transport-level 401.
        if (c.req.path === "/graphql") {
          return c.json({
            data: null,
            errors: [{ message: "Missing or invalid API key", extensions: { code: "UNAUTHENTICATED" } }],
          });
        }
        return fail(c, 401, "unauthorized", "missing or invalid x-api-key");
      }
      const sessionId = c.req.header("x-session-id") ?? "anonymous";
      const s = session(store, sessionId);
      c.set("sessionId", sessionId);
      c.set("flags", s.flags);

      if (s.flags.has("slow_tool")) await sleep(slowMs);
      const key = `${c.req.method} ${c.req.path}`;
      if (s.flags.has("flaky_503_then_ok") && firstHit(s, `503:${key}`)) {
        return fail(c, 503, "upstream_unavailable", "temporarily unavailable");
      }
      if (s.flags.has("rate_limited_with_retry_after") && firstHit(s, `429:${key}`)) {
        c.header("Retry-After", "1");
        return fail(c, 429, "rate_limited", "too many requests");
      }
      await next();
    });
  }

  // ---- REST ----
  app.get("/v1/loans", (c) => {
    const phone = c.req.query("phone");
    if (!phone) return fail(c, 400, "invalid_request", "phone query param required");
    if (c.var.flags.has("empty_loans")) return c.json([]);
    const customerIds = new Set([...store.customers.values()].filter((x) => x.phone === phone).map((x) => x.id));
    const rows = [...store.loans.values()].filter((l) => customerIds.has(l.customerId));
    return c.json(rows.map((l) => loanView(store, l, c.var.flags)));
  });

  app.get("/v1/loans/:id", (c) => {
    const loan = store.loans.get(c.req.param("id"));
    if (!loan) return fail(c, 404, "not_found", "loan not found");
    return c.json(loanView(store, loan, c.var.flags));
  });

  app.get("/v1/loans/:id/linked-accounts", (c) => {
    const loan = store.loans.get(c.req.param("id"));
    if (!loan) return fail(c, 404, "not_found", "loan not found");
    const rows = [...store.accounts.values()].filter((a) => a.customerId === loan.customerId);
    return c.json(rows.map(({ id, bankName, last4 }) => ({ id, bankName, last4 })));
  });

  // The backend, not the agent, decides which amounts are payable. SPEC §4.
  app.get("/v1/loans/:id/payment-options", (c) => {
    const loan = store.loans.get(c.req.param("id"));
    if (!loan) return fail(c, 404, "not_found", "loan not found");
    if (loan.status === "paid_off" || !loan.nextPayment) {
      return fail(c, 409, "loan_paid_off", "nothing is due on this loan");
    }
    const due = loan.nextPayment.amountDueCents;
    return c.json({
      minCents: due,
      maxCents: loan.payoffAmountCents,
      suggested: [
        { label: "amount_due", amountCents: due },
        { label: "payoff", amountCents: loan.payoffAmountCents },
      ],
    });
  });

  app.post("/v1/payments", async (c) => {
    const key = c.req.header("idempotency-key");
    if (!key) return fail(c, 400, "idempotency_key_required", "Idempotency-Key header is required");
    const parsed = PaymentBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return fail(c, 400, "invalid_request", parsed.error.message);
    const body = parsed.data;

    const fingerprint = JSON.stringify(body);
    const prior = store.idempotency.get(key);
    if (prior) {
      if (prior.fingerprint !== fingerprint) {
        return fail(c, 422, "idempotency_key_reused", "Idempotency-Key was used with a different request");
      }
      c.header("Idempotent-Replayed", "true");
      return c.json(prior.body, prior.status);
    }

    const loan = store.loans.get(body.loanId);
    if (!loan) return fail(c, 404, "not_found", "loan not found");
    const account = store.accounts.get(body.linkedAccountId);
    if (!account || account.customerId !== loan.customerId) {
      return fail(c, 403, "forbidden", "linked account does not belong to the loan's customer");
    }
    if (loan.status === "paid_off" || !loan.nextPayment) return fail(c, 409, "loan_paid_off", "nothing is due");
    if (body.amountCents < loan.nextPayment.amountDueCents || body.amountCents > loan.payoffAmountCents) {
      return fail(c, 422, "invalid_amount", "amount is outside the allowed payment range");
    }

    const s = session(store, c.var.sessionId);
    const failureCode = c.var.flags.has("payment_declined")
      ? "payment_declined"
      : c.var.flags.has("insufficient_funds")
        ? "insufficient_funds"
        : c.var.flags.has("payment_declined_once") && firstHit(s, "decline_once")
          ? "payment_declined"
          : null;

    const payment: Payment = {
      id: `P${store.payments.length + 1}-${randomUUID().slice(0, 8)}`,
      loanId: loan.id,
      linkedAccountId: account.id,
      amountCents: body.amountCents,
      status: failureCode ? "failed" : "succeeded",
      failureCode,
      idempotencyKey: key,
      createdAt: new Date(now()).toISOString(),
    };
    store.payments.push(payment);

    if (!failureCode) {
      loan.principalBalanceCents = Math.max(0, loan.principalBalanceCents - body.amountCents);
      loan.payoffAmountCents -= body.amountCents;
      if (loan.payoffAmountCents === 0) {
        loan.status = "paid_off";
        loan.nextPayment = null;
      } else {
        // The amount is never below the amount due (checked above), so the loan is paid up: like a real servicer,
        // the schedule moves to the next installment instead of showing zero due on the old date.
        if (loan.status === "past_due") loan.status = "current";
        loan.nextPayment = {
          amountDueCents: Math.min(loan.monthlyPaymentCents, loan.payoffAmountCents),
          dueDate: nextMonth(loan.nextPayment.dueDate),
        };
      }
    }

    const status = failureCode ? 402 : 201;
    const resBody = failureCode
      ? { error: { code: failureCode, message: "the bank declined this payment" }, payment }
      : payment;
    store.idempotency.set(key, { fingerprint, status, body: resBody });

    // Committed server-side, but the client never hears back: only the idempotency key saves it.
    if (c.var.flags.has("timeout") && firstHit(s, "payment_timeout")) await sleep(hangMs);

    return c.json(resBody, status);
  });

  // 202 whether or not the loan exists, so this endpoint cannot be used to enumerate accounts.
  app.post("/v1/step-up/send", async (c) => {
    const parsed = z.object({ loanId: z.string() }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return fail(c, 400, "invalid_request", parsed.error.message);
    if (c.var.flags.has("sms_unavailable")) return fail(c, 503, "sms_unavailable", "SMS provider unavailable");

    const loan = store.loans.get(parsed.data.loanId);
    const customer = loan && store.customers.get(loan.customerId);
    if (customer) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      store.stepUp.set(parsed.data.loanId, {
        code,
        phone: customer.phone,
        expiresAt: now() + STEP_UP_TTL_MS,
        checks: 0,
        used: false,
      });
      store.lastCodeByPhone.set(customer.phone, code);
    }
    return c.body(null, 202);
  });

  app.post("/v1/step-up/check", async (c) => {
    const parsed = z.object({ loanId: z.string(), code: z.string() }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return fail(c, 400, "invalid_request", parsed.error.message);
    const rec = store.stepUp.get(parsed.data.loanId);
    if (!rec) return c.json({ passed: false });
    rec.checks += 1;
    const passed =
      !rec.used && rec.checks <= STEP_UP_MAX_CHECKS && now() < rec.expiresAt && rec.code === parsed.data.code;
    if (passed) rec.used = true;
    return c.json({ passed });
  });

  app.patch("/v1/loans/:id/autopay", async (c) => {
    const loan = store.loans.get(c.req.param("id"));
    if (!loan) return fail(c, 404, "not_found", "loan not found");
    const parsed = AutopayBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return fail(c, 400, "invalid_request", parsed.error.message);
    const { enabled, linkedAccountId } = parsed.data;
    if (enabled) {
      const account = linkedAccountId ? store.accounts.get(linkedAccountId) : undefined;
      if (!account || account.customerId !== loan.customerId) {
        return fail(c, 403, "forbidden", "autopay needs a linked account owned by the loan's customer");
      }
    }
    loan.autopay = { enabled, linkedAccountId: enabled ? linkedAccountId : null };
    return c.json(loan.autopay);
  });

  // ---- GraphQL ----
  app.on(["GET", "POST"], "/graphql", (c) => yoga.fetch(c.req.raw, { flags: c.var.flags }));

  return { app, store };
}

// "2026-10-31" → "2026-11-30": same day next month, clamped to the month's last day.
function nextMonth(isoDate: string): string {
  const [y = 0, m = 1, d = 1] = isoDate.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, lastDay))).toISOString().slice(0, 10);
}
