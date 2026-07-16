import { serve } from "@hono/node-server";
import { buildApp } from "./app";
import { createServices } from "./services";

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: buildApp(createServices()).fetch, port });
console.log(`sidekick server listening on http://localhost:${port}`);
