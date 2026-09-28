import { handle } from "hono/vercel";
import app from "../server/index.js";

export const config = {
  runtime: "nodejs",
  maxDuration: 30,
};

const handler = handle(app);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
