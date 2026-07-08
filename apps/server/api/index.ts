import { handle } from "hono/vercel";
import { buildApp } from "../src/app";
import { createServices } from "../src/services";

export const config = { runtime: "nodejs" };

const app = buildApp(createServices());

export default handle(app);
