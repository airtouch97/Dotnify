/**
 * Revert a logged DNS change to its BEFORE state.
 *
 *   create → delete the created record
 *   update → set the record back to its old type/name/content/ttl/proxied/…
 *            (recreates it if it has since been deleted — forced only)
 *   delete → recreate the deleted record
 *
 * Before touching DNS the current record is compared with the entry's AFTER
 * snapshot. If something changed since (edited again, deleted, identical
 * record already present, …) a conflict is returned and nothing happens
 * unless `force` is set. The restore itself goes through the logged mutation
 * helpers, so it is recorded as a new change (with `restoreOf`).
 */
import { getChange, saveChange, withOperation, type DnsChange } from "./changelog.js";
import { createNewRecord, deleteRecordById, findProvider, listZoneRecords, updateExistingRecord } from "./dns.js";
import type { DnsRecord } from "./types.js";
import type { ImportRecord } from "./import.js";

export class RestoreError extends Error {
  status: 400 | 404 | 409 | 502;
  conflicts?: string[];
  current?: DnsRecord | null;
  constructor(message: string, status: 400 | 404 | 409 | 502, extra?: { conflicts?: string[]; current?: DnsRecord | null }) {
    super(message);
    this.name = "RestoreError";
    this.status = status;
    this.conflicts = extra?.conflicts;
    this.current = extra?.current;
  }
}

const normName = (n: string) => n.trim().toLowerCase().replace(/\.$/, "");

/** Differences between the live record and the snapshot we expect to see. */
export function recordDiffs(expected: DnsRecord, current: DnsRecord): string[] {
  const out: string[] = [];
  if (expected.type !== current.type) out.push(`type is ${current.type} (expected ${expected.type})`);
  if (normName(expected.name) !== normName(current.name)) out.push(`name is ${current.name} (expected ${expected.name})`);
  if (expected.content !== current.content) out.push(`content is ${current.content} (expected ${expected.content})`);
  if (expected.ttl !== undefined && current.ttl !== undefined && expected.ttl !== current.ttl) out.push(`TTL is ${current.ttl} (expected ${expected.ttl})`);
  if (expected.proxied !== undefined && current.proxied !== undefined && expected.proxied !== current.proxied)
    out.push(`proxied is ${current.proxied} (expected ${expected.proxied})`);
  if (expected.priority !== undefined && current.priority !== undefined && expected.priority !== current.priority)
    out.push(`priority is ${current.priority} (expected ${expected.priority})`);
  return out;
}

function toImport(r: DnsRecord): ImportRecord {
  return {
    type: r.type,
    name: r.name,
    content: r.content,
    ttl: r.ttl,
    ...(r.proxied !== undefined ? { proxied: r.proxied } : {}),
    ...(r.priority !== undefined ? { priority: r.priority } : {}),
    ...(r.line ? { line: r.line } : {}),
    ...(r.weight !== undefined ? { weight: r.weight } : {}),
    ...(r.comment !== undefined ? { comment: r.comment } : {}),
  };
}

export interface RestorePlan {
  change: DnsChange;
  /** What the restore will do. */
  operation: "delete" | "update" | "create" | "noop";
  conflicts: string[];
  current: DnsRecord | null;
}

export async function planRestore(id: string): Promise<RestorePlan & { records: DnsRecord[] }> {
  const change = await getChange(id);
  if (!change) throw new RestoreError("Change not found", 404);
  const provider = await findProvider(change.providerId);
  if (!provider) throw new RestoreError(`Provider "${change.providerName}" no longer exists`, 404);

  let records: DnsRecord[];
  try {
    records = await listZoneRecords(provider, change.zoneId, change.domain);
  } catch (e) {
    throw new RestoreError(`Could not read current records of ${change.domain}: ${e instanceof Error ? e.message : String(e)}`, 502);
  }

  const conflicts: string[] = [];
  if (change.restoredBy) conflicts.push(`This change was already restored (change ${change.restoredBy}).`);
  if (change.status === "error") conflicts.push("This change failed when it was made, so DNS may never have changed.");
  if (change.status === "pending") conflicts.push("This change never reported a result; its outcome is unknown.");

  const recordId = change.recordId ?? change.after?.id ?? change.before?.id ?? null;
  const current = recordId ? records.find((r) => r.id === recordId) ?? null : null;
  let operation: RestorePlan["operation"];

  if (change.action === "create") {
    if (!current) {
      operation = "noop";
      conflicts.push("The created record no longer exists — nothing to delete.");
    } else {
      operation = "delete";
      if (change.after) {
        const d = recordDiffs(change.after, current);
        if (d.length) conflicts.push(`The record was changed after this change: ${d.join("; ")}.`);
      }
    }
  } else if (change.action === "update") {
    if (!change.before) throw new RestoreError("This change has no BEFORE snapshot", 400);
    if (!current) {
      operation = "create";
      conflicts.push("The record has since been deleted; restoring will recreate it with the old values.");
    } else {
      operation = "update";
      if (change.after) {
        const d = recordDiffs(change.after, current);
        if (d.length) conflicts.push(`The record was changed after this change: ${d.join("; ")}.`);
      }
      if (recordDiffs(change.before, current).length === 0) conflicts.push("The record already has the old values.");
    }
  } else {
    if (!change.before) throw new RestoreError("This change has no BEFORE snapshot", 400);
    operation = "create";
    const b = change.before;
    const dup = records.find((r) => r.type === b.type && normName(r.name) === normName(b.name) && r.content === b.content);
    if (dup) conflicts.push(`An identical ${b.type} record already exists (id ${dup.id}).`);
    const cname = records.find((r) => normName(r.name) === normName(b.name) && (r.type === "CNAME") !== (b.type === "CNAME"));
    if (cname) conflicts.push(`${b.name} now has a ${cname.type} record (${cname.content}); the provider may reject the restore.`);
  }
  return { change, operation, conflicts, current, records };
}

export async function restoreChange(id: string, force: boolean) {
  const plan = await planRestore(id);
  const { change, operation, conflicts, current } = plan;
  if (operation === "noop") throw new RestoreError(conflicts[0] ?? "Nothing to restore", 409, { conflicts, current });
  if (conflicts.length && !force) {
    throw new RestoreError("The record changed since this change was made. Review and force the restore if you still want it.", 409, { conflicts, current });
  }
  const provider = (await findProvider(change.providerId))!;
  let restoreEntry: DnsChange | null = null;
  const opts = { restoreOf: change.id, onChange: (c: DnsChange) => (restoreEntry = c) };

  try {
    await withOperation(`restore:${change.id}`, async () => {
      if (operation === "delete") {
        await deleteRecordById(provider, change.zoneId, change.domain, current!.id, { ...opts, before: current });
      } else if (operation === "update") {
        await updateExistingRecord(provider, change.zoneId, change.domain, current!.id, toImport(change.before!), { ...opts, before: current });
      } else {
        await createNewRecord(provider, change.zoneId, change.domain, toImport(change.before!), opts);
      }
    });
  } catch (e) {
    throw new RestoreError(`Restore failed: ${e instanceof Error ? e.message : String(e)}`, 502);
  }

  const entry = restoreEntry as DnsChange | null;
  const fresh = (await getChange(change.id)) ?? change;
  if (entry) {
    fresh.restoredBy = entry.id;
    await saveChange(fresh).catch(() => {});
  }
  return { restored: true, operation, forced: conflicts.length > 0, conflicts, change: fresh, restoreChange: entry };
}
