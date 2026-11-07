// CLAUDE-OWNED (M10). The viewer's HTTP API: read-only history from SQLite, plus live calls. Local only.
import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import type { CallFilter, ViewerData } from "./data.js";
import { LiveError, type Live } from "./live.js";

const Source = z.enum(["sim", "manual", "synthetic_prod"]);
const Outcome = z.enum(["resolved", "transferred", "abandoned"]);
const CallQuery = z.object({
  source: Source.optional(),
  version: z.string().optional(),
  outcome: Outcome.optional(),
  gateRunId: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().optional(),
  offset: z.coerce.number().int().optional(),
});
const StartBody = z.object({
  phone: z.string().nullable(),
  channel: z.enum(["chat", "voice"]),
  flags: z.array(z.string()),
  arm: z.enum(["stable", "candidate"]),
});
const SayBody = z.object({ text: z.string() });

const LIVE_STATUS: Record<LiveError["code"], ContentfulStatusCode> = {
  not_found: 404,
  busy: 409,
  ended: 409,
  bad_request: 400,
  model_unavailable: 503,
};

function fail(c: Context, status: ContentfulStatusCode, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

export function createViewerApi(deps: { data: ViewerData; live: Live }) {
  const { data, live } = deps;
  const api = new Hono();

  api.onError((err, c) => {
    if (err instanceof LiveError) return fail(c, LIVE_STATUS[err.code], err.code, err.message);
    console.error(err);
    return fail(c, 500, "internal", "the viewer API failed; see the server log");
  });

  api.get("/summary", (c) => c.json(data.summary()));
  api.get("/gate-runs", (c) => c.json(data.gateRuns()));
  api.get("/incident", (c) => c.json(data.incident()));
  api.get("/gate-runs/:id", (c) => {
    const run = data.gateRun(c.req.param("id"));
    return run === null ? fail(c, 404, "not_found", "no such gate run") : c.json(run);
  });

  api.get("/calls", (c) => {
    const q = CallQuery.safeParse(c.req.query());
    if (!q.success) return fail(c, 400, "bad_request", q.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const filter: CallFilter = Object.fromEntries(Object.entries(q.data).filter(([, v]) => v !== undefined));
    return c.json(data.calls(filter));
  });
  api.get("/calls/:id", (c) => {
    const call = data.call(c.req.param("id"));
    return call === null ? fail(c, 404, "not_found", "no such call") : c.json(call);
  });

  api.get("/live/options", (c) => c.json(live.options()));
  api.post("/live/calls", async (c) => {
    const body = StartBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return fail(c, 400, "bad_request", "expected { phone, channel, flags, arm }");
    return c.json(await live.start(body.data), 201);
  });
  api.get("/live/calls/:id", (c) => c.json(live.get(c.req.param("id"))));
  api.post("/live/calls/:id/say", async (c) => {
    const body = SayBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return fail(c, 400, "bad_request", "expected { text }");
    return c.json(await live.say(c.req.param("id"), body.data.text));
  });
  api.post("/live/calls/:id/hangup", (c) => c.json(live.hangUp(c.req.param("id"))));

  return new Hono().route("/api", api);
}
