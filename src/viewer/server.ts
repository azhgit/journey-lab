// CLAUDE-OWNED (M10). Serves the viewer: the API under /api and the built React app (viewer/dist).
//   npm run viewer        build the app, then serve both on http://localhost:4020
//   npm run viewer:api    API only, for `npm run viewer:dev` (Vite proxies /api here)
// Local only: live calls use ANTHROPIC_API_KEY from .env. Never expose this server.
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readFileSync } from "node:fs";
import { makePayment } from "../../journeys/make-payment.js";
import { makePaymentCandidate } from "../../journeys/make-payment.candidate.js";
import { openDb } from "../db/db.js";
import { anthropicModel } from "../journey/anthropic.js";
import { loadKnowledge } from "../tools/searchKnowledge.js";
import { createViewerApi } from "./api.js";
import { createViewerData } from "./data.js";
import { createLive } from "./live.js";

const port = Number(process.env.VIEWER_PORT ?? 4020);
const dbPath = process.env.VIEWER_DB ?? "data/journey-lab.db";
const modelName = process.env.AGENT_MODEL ?? "claude-haiku-5-5";

const db = openDb(dbPath);
const live = createLive({
  journeys: { stable: makePayment, candidate: makePaymentCandidate },
  articles: loadKnowledge("knowledge"),
  model: process.env.ANTHROPIC_API_KEY ? anthropicModel({ model: modelName }) : null,
  modelName,
  db,
});
const app = createViewerApi({ data: createViewerData(db.sql), live });

const DIST = "viewer/dist";
if (existsSync(DIST)) {
  app.use("/*", serveStatic({ root: DIST }));
  // Client-side routes (/calls/…) get the app shell.
  const shell = readFileSync(`${DIST}/index.html`, "utf8");
  app.get("*", (c) => c.html(shell));
}

serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, (info) => {
  console.log(`viewer on http://localhost:${info.port}${existsSync(DIST) ? "" : " (API only: no viewer/dist yet)"}`);
  console.log(`database ${dbPath} · live model ${process.env.ANTHROPIC_API_KEY ? modelName : "off (no ANTHROPIC_API_KEY): replay only"}`);
});
