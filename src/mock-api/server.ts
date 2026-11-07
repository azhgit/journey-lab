import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const port = Number(process.env.MOCK_API_PORT ?? 4010);
const apiKey = process.env.MOCK_API_KEY ?? "dev-key";
const testRoutes = process.env.NODE_ENV === "test";

const { app } = createApp({ apiKey, testRoutes });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`mock-api on http://localhost:${info.port} (test routes ${testRoutes ? "on" : "off"})`);
});
