import { Hono } from "hono";
import { requireAuth } from "../lib/middleware.js";
import { ok, notFound } from "../lib/response.js";
import { getChange, listChanges, MAX_ENTRIES } from "../lib/changelog.js";
import { planRestore, restoreChange, RestoreError } from "../lib/restore.js";
import type { AuthedVariables } from "../lib/types.js";

/**
 * DNS change log (backup of every DNS mutation) + restore.
 *
 *   GET  /api/changes?domain=&token=&cursor=&limit=   newest first
 *   GET  /api/changes/:id                       one entry
 *   GET  /api/changes/:id/restore-check         conflicts / what a restore would do
 *   POST /api/changes/:id/restore  { force? }   revert to BEFORE (logged as a new change)
 */
const changes = new Hono<{ Variables: AuthedVariables }>();
changes.use("/*", requireAuth);

changes.get("/", async (c) => {
  const cursor = Number(c.req.query("cursor") ?? 0) || 0;
  const limit = Number(c.req.query("limit") ?? 50) || 50;
  const result = await listChanges({ domain: c.req.query("domain") ?? undefined, tokenId: c.req.query("token") ?? undefined, cursor, limit });
  return ok(c, { ...result, cap: MAX_ENTRIES });
});

changes.get("/:id", async (c) => {
  const entry = await getChange(c.req.param("id"));
  if (!entry) return notFound(c, "Change not found");
  return ok(c, entry);
});

function restoreErr(c: Parameters<typeof ok>[0], e: unknown) {
  if (e instanceof RestoreError) {
    return c.json({ ok: false, error: e.message, conflicts: e.conflicts ?? [], current: e.current ?? null }, e.status);
  }
  throw e;
}

changes.get("/:id/restore-check", async (c) => {
  try {
    const { change, operation, conflicts, current } = await planRestore(c.req.param("id"));
    return ok(c, { id: change.id, operation, conflicts, current });
  } catch (e) {
    return restoreErr(c, e);
  }
});

changes.post("/:id/restore", async (c) => {
  let body: { force?: unknown } = {};
  try {
    body = await c.req.json<{ force?: unknown }>();
  } catch {
    /* empty body */
  }
  try {
    return ok(c, await restoreChange(c.req.param("id"), body.force === true));
  } catch (e) {
    return restoreErr(c, e);
  }
});

export default changes;
