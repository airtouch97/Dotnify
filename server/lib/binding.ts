/**
 * Server ⇄ hostname binding logic, used by the MCP tools and the REST API.
 *
 * "Binding" server X to a hostname means making sure the hostname has an
 * A (IPv4) or AAAA (IPv6) record pointing at the server's IP, via whichever
 * DNS provider manages the hostname's zone.
 */
import {
  createNewRecord,
  deleteRecordById,
  listAllZones,
  listZoneRecords,
  loadProviders,
  normalizeRecordName,
  updateExistingRecord,
  type ZoneWithProvider,
} from "./dns.js";
import { createServer, findServer, findServerByIp, listServers, normalizeIp, sameIp, validateNewServer } from "./servers.js";
import type { DnsRecord, Provider, RecordType, ServerEntry } from "./types.js";

export class BindingError extends Error {
  status: 400 | 404 | 409 | 502;
  constructor(message: string, status: 400 | 404 | 409 | 502 = 400) {
    super(message);
    this.name = "BindingError";
    this.status = status;
  }
}

/** A DNS record enriched with its fully-qualified hostname. */
export interface RecordView extends DnsRecord {
  host: string; // relative host ("@" for apex)
  hostname: string; // FQDN, e.g. api.example.com
}

/**
 * Normalize user input into a bare lowercase hostname:
 * strips scheme, path, port, trailing dot and whitespace; converts IDN to punycode.
 */
export function normalizeHostname(input: string): string {
  let h = input.trim().toLowerCase();
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // scheme
  h = h.split(/[/?#]/)[0]; // path
  h = h.replace(/:\d+$/, ""); // port
  h = h.replace(/\.+$/, ""); // trailing dot
  if (/[^\x00-\x7f]/.test(h)) {
    try {
      h = new URL(`http://${h}`).hostname;
    } catch {
      /* fall through to validation */
    }
  }
  if (!h || h.length > 253 || !/^(\*\.)?([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(h)) {
    throw new BindingError(`Invalid hostname: ${input}`);
  }
  return h;
}

function zoneFqdn(host: string, zoneName: string): string {
  return host === "@" ? zoneName : `${host}.${zoneName}`;
}

export function toRecordView(r: DnsRecord, zoneName: string): RecordView {
  const host = normalizeRecordName(r.name, zoneName);
  return { ...r, host, hostname: zoneFqdn(host, zoneName) };
}

/** Split a (possibly multi-value, Huawei-style "a, b") record content into values. */
function contentValues(content: string): string[] {
  return content.split(",").map((v) => v.trim()).filter(Boolean);
}

function recordPointsTo(r: DnsRecord, ip: string): boolean {
  return (r.type === "A" || r.type === "AAAA") && contentValues(r.content).some((v) => sameIp(v, ip));
}

interface ResolvedTarget {
  zone: ZoneWithProvider;
  provider: Provider;
  host: string; // relative host, "@" for apex
  hostname: string; // FQDN
}

function bareZone(name: string): string {
  return name.toLowerCase().replace(/\.$/, "");
}

/**
 * Resolve ONE managed domain (zone) by name or zone id. Only lists zones
 * (cheap); never reads records of other domains.
 */
export async function resolveDomain(domainInput: string): Promise<{ zone: ZoneWithProvider; provider: Provider; allZones: ZoneWithProvider[] }> {
  const raw = domainInput.trim();
  if (!raw) throw new BindingError("domain is required (call list_domains first)");
  const { zones, errors } = await listAllZones();
  const byId = zones.filter((z) => z.id === raw);
  let matches = byId;
  if (matches.length === 0) {
    const d = normalizeHostname(raw);
    matches = zones.filter((z) => bareZone(z.name) === d);
  }
  if (matches.length === 0) {
    const managed = zones.map((z) => z.name).join(", ") || "(none)";
    throw new BindingError(
      `Domain "${raw}" is not managed by Dotnify. Managed domains: ${managed}` +
        (errors.length ? ` (some providers failed to load: ${errors.map((e) => e.providerName).join(", ")})` : "") +
        ". Call list_domains to see valid values.",
      404,
    );
  }
  if (matches.length > 1) {
    throw new BindingError(
      `Domain "${matches[0].name}" is managed by multiple providers (${matches.map((z) => `${z.providerName} [zone id ${z.id}]`).join(", ")}). Pass the zone id as "domain" to choose one.`,
      409,
    );
  }
  const zone = matches[0];
  const providers = await loadProviders();
  const provider = providers.find((p) => p.id === zone.providerId);
  if (!provider) throw new BindingError("Provider for this domain no longer exists", 404);
  return { zone, provider, allZones: zones };
}

/**
 * Resolve a host inside a given domain. `hostInput` may be relative
 * ("api", "@") or fully-qualified ("api.example.com").
 */
export async function resolveTarget(domain: string, hostInput: string): Promise<ResolvedTarget> {
  const { zone, provider, allZones } = await resolveDomain(domain);
  const zn = bareZone(zone.name);
  const h = hostInput.trim().toLowerCase().replace(/\.+$/, "");
  let hostname: string;
  if (h === "" || h === "@" || h === zn) {
    hostname = zn;
  } else if (h.endsWith(`.${zn}`)) {
    hostname = normalizeHostname(h);
  } else {
    // Looks like an FQDN of a *different* managed domain? Refuse instead of
    // silently creating "api.other.com.example.com".
    const other = allZones.find((z) => {
      const o = bareZone(z.name);
      return o !== zn && (h === o || h.endsWith(`.${o}`));
    });
    if (other) {
      throw new BindingError(`"${hostInput}" belongs to domain ${other.name}, not ${zone.name}. Use domain="${other.name}".`);
    }
    hostname = normalizeHostname(`${h}.${zn}`);
  }
  const host = hostname === zn ? "@" : hostname.slice(0, -(zn.length + 1));
  return { zone, provider, host, hostname };
}

async function requireServer(idOrName: string): Promise<ServerEntry> {
  const server = await findServer(idOrName);
  if (!server) {
    const names = (await listServers()).map((s) => `${s.name} (${s.ip})`).join(", ") || "(none)";
    throw new BindingError(`Server not found: "${idOrName}". Known servers: ${names}`, 404);
  }
  return server;
}

async function fetchRecords(t: ResolvedTarget): Promise<RecordView[]> {
  try {
    const records = await listZoneRecords(t.provider, t.zone.id, t.zone.name);
    return records.map((r) => toRecordView(r, t.zone.name));
  } catch (e) {
    throw new BindingError(`Failed to fetch records for ${t.zone.name}: ${e instanceof Error ? e.message : String(e)}`, 502);
  }
}

function summarizeZone(t: ResolvedTarget) {
  return { domain: t.zone.name, zoneId: t.zone.id, provider: t.provider.name, providerType: t.provider.type };
}

export interface BindOptions {
  /** Existing server name/id. Either this or `ip` is required. */
  server?: string;
  /** Raw IPv4/IPv6. Uses the matching server, or creates one named `serverName`. */
  ip?: string;
  /** Name for a new server entry when `ip` is not yet in the table. */
  serverName?: string;
  serverNote?: string;
  domain: string;
  hostname: string;
  ttl?: number;
  proxied?: boolean;
  recordId?: string;
  dryRun?: boolean;
}

export type BindAction = "created" | "updated" | "unchanged";

/**
 * Point `hostname` at the server's IP. Creates an A/AAAA record, or updates
 * the existing A/AAAA record for that host if there is exactly one (or the
 * one given by recordId). Refuses to touch CNAME conflicts or ambiguous
 * multi-record hosts.
 */
interface BindServerPlan {
  server: { name: string; ip: string; ipVersion: 4 | 6 };
  /** "existing": already in the table; "create": will be added (or would be, on dry run). */
  source: "existing" | "create";
  note?: string; // informational message for the caller
  create?: { name: string; ip: string; note?: string };
}

/**
 * Work out which server a bind refers to: an existing server (by name/id or
 * by IP), or a new server entry to create from `ip` + `serverName`.
 * Never writes anything.
 */
async function planBindServer(opts: BindOptions): Promise<BindServerPlan> {
  const serverRef = opts.server?.trim();
  const ipInput = opts.ip?.trim();

  if (!serverRef && !ipInput) {
    throw new BindingError('Provide either "server" (an existing server name/id) or "ip" (with "server_name" if that IP is not in the server table yet).');
  }

  if (serverRef && !ipInput) {
    const s = await requireServer(serverRef);
    return { server: { name: s.name, ip: s.ip, ipVersion: s.ipVersion }, source: "existing" };
  }

  const parsed = normalizeIp(ipInput!);
  if (!parsed) throw new BindingError(`Invalid IP address: ${ipInput}`);

  if (serverRef) {
    // Both given: they must agree.
    const s = await requireServer(serverRef);
    if (!sameIp(s.ip, parsed.ip)) {
      throw new BindingError(
        `Server "${s.name}" has IP ${s.ip}, not ${parsed.ip}. To bind ${parsed.ip}, pass only "ip" (plus "server_name" if it is new); to change the server's IP use update_server.`,
        409,
      );
    }
    return { server: { name: s.name, ip: s.ip, ipVersion: s.ipVersion }, source: "existing" };
  }

  const existing = await findServerByIp(parsed.ip);
  if (existing) {
    const wanted = opts.serverName?.trim();
    const note =
      wanted && wanted.toLowerCase() !== existing.name.toLowerCase()
        ? `IP ${existing.ip} is already in the server table as "${existing.name}"; server_name "${wanted}" was ignored (use update_server to rename).`
        : undefined;
    return { server: { name: existing.name, ip: existing.ip, ipVersion: existing.ipVersion }, source: "existing", ...(note ? { note } : {}) };
  }

  const wanted = opts.serverName?.trim();
  if (!wanted) {
    const names = (await listServers()).map((s) => s.name).join(", ") || "(none)";
    throw new BindingError(
      `IP ${parsed.ip} is not in the server table yet, so it needs a name. Ask the user what to call this server (or propose a name, e.g. based on the hostname) and call bind_server_to_domain again with ip="${parsed.ip}" and server_name="<name>". Existing server names: ${names}.`,
    );
  }
  const v = await validateNewServer({ name: wanted, ip: parsed.ip, note: opts.serverNote });
  return {
    server: { name: v.name, ip: v.ip, ipVersion: v.version },
    source: "create",
    create: { name: v.name, ip: v.ip, ...(v.note ? { note: v.note } : {}) },
  };
}

export async function bindServer(opts: BindOptions) {
  const plan = await planBindServer(opts);
  const server = plan.server;
  const type: RecordType = server.ipVersion === 6 ? "AAAA" : "A";
  const target = await resolveTarget(opts.domain, opts.hostname);
  const records = await fetchRecords(target);
  const sameHost = records.filter((r) => r.host === target.host);

  const base = {
    server: { name: server.name, ip: server.ip },
    serverEntry: plan.source === "existing" ? "existing" : opts.dryRun ? "would_create" : "created",
    ...(plan.note ? { note: plan.note } : {}),
    hostname: target.hostname,
    host: target.host,
    type,
    ...summarizeZone(target),
    dryRun: !!opts.dryRun,
  };

  /** Create the new server entry (real runs only), right before the DNS write. */
  const ensureServer = async () => {
    if (plan.create && !opts.dryRun) await createServer(plan.create);
  };
  const serverMsg = plan.create ? (opts.dryRun ? ` Would add server "${server.name}" (${server.ip}) to the server table.` : ` Added server "${server.name}" (${server.ip}) to the server table.`) : "";

  const cname = sameHost.find((r) => r.type === "CNAME");
  if (cname) {
    throw new BindingError(
      `${target.hostname} already has a CNAME record (→ ${cname.content}, record id ${cname.id}). A CNAME cannot coexist with an ${type} record; delete the CNAME first if you really want to replace it.`,
      409,
    );
  }

  let matches = sameHost.filter((r) => r.type === type);
  if (opts.recordId) {
    matches = matches.filter((r) => r.id === opts.recordId);
    if (matches.length === 0) throw new BindingError(`No ${type} record with id ${opts.recordId} on ${target.hostname}`, 404);
  }

  const already = matches.find((r) => recordPointsTo(r, server.ip) && contentValues(r.content).length === 1);
  if (already) {
    await ensureServer();
    return { ...base, action: "unchanged" as BindAction, record: already, message: `${target.hostname} already points to ${server.name} (${server.ip}).${serverMsg}` };
  }

  const isCf = target.provider.type === "cloudflare";
  const recordName = isCf ? target.hostname : target.host;

  if (matches.length === 0) {
    const ttl = opts.ttl ?? (isCf ? 1 : 600);
    const planned = { type, name: recordName, content: server.ip, ttl, ...(isCf ? { proxied: opts.proxied ?? false } : {}) };
    if (opts.dryRun) {
      return { ...base, action: "created" as BindAction, planned, message: `Would create ${type} ${target.hostname} → ${server.ip}.${serverMsg}` };
    }
    await ensureServer();
    try {
      const created = await createNewRecord(target.provider, target.zone.id, target.zone.name, planned);
      return { ...base, action: "created" as BindAction, record: toRecordView(created, target.zone.name), message: `Created ${type} ${target.hostname} → ${server.ip}.${serverMsg}` };
    } catch (e) {
      throw new BindingError(`Failed to create record: ${e instanceof Error ? e.message : String(e)}${plan.create ? ` (server "${server.name}" was already added to the server table)` : ""}`, 502);
    }
  }

  if (matches.length > 1) {
    throw new BindingError(
      `${target.hostname} has ${matches.length} ${type} records (${matches.map((r) => `id ${r.id}: ${r.content}${r.line ? ` [line ${r.line}]` : ""}`).join("; ")}). Pass record_id to choose which one to update.`,
      409,
    );
  }

  const existing = matches[0];
  const planned = {
    type,
    name: recordName,
    content: server.ip,
    ttl: opts.ttl ?? existing.ttl,
    ...(isCf && opts.proxied !== undefined ? { proxied: opts.proxied } : {}),
  };
  const previous = { id: existing.id, content: existing.content, ttl: existing.ttl };
  if (opts.dryRun) {
    return { ...base, action: "updated" as BindAction, previous, planned, message: `Would update ${type} ${target.hostname}: ${existing.content} → ${server.ip}.${serverMsg}` };
  }
  await ensureServer();
  try {
    await updateExistingRecord(target.provider, target.zone.id, target.zone.name, existing.id, planned, { before: existing });
  } catch (e) {
    throw new BindingError(`Failed to update record: ${e instanceof Error ? e.message : String(e)}${plan.create ? ` (server "${server.name}" was already added to the server table)` : ""}`, 502);
  }
  return { ...base, action: "updated" as BindAction, previous, recordId: existing.id, message: `Updated ${type} ${target.hostname}: ${existing.content} → ${server.ip}.${serverMsg}` };
}

export interface UnbindOptions {
  server: string;
  domain: string;
  hostname: string;
  recordId?: string;
  dryRun?: boolean;
}

/**
 * Remove the A/AAAA record(s) on `hostname` that point to the server's IP.
 * Records pointing elsewhere are never touched. For multi-value record sets
 * (Huawei Cloud) only the server's IP is removed from the set.
 */
export async function unbindServer(opts: UnbindOptions) {
  const server = await requireServer(opts.server);
  const target = await resolveTarget(opts.domain, opts.hostname);
  const records = await fetchRecords(target);
  let matches = records.filter((r) => r.host === target.host && recordPointsTo(r, server.ip));
  if (opts.recordId) matches = matches.filter((r) => r.id === opts.recordId);

  const base = {
    server: { name: server.name, ip: server.ip },
    hostname: target.hostname,
    ...summarizeZone(target),
    dryRun: !!opts.dryRun,
  };

  if (matches.length === 0) {
    const current = records
      .filter((r) => r.host === target.host)
      .map((r) => ({ id: r.id, type: r.type, content: r.content }));
    return { ...base, removed: [], message: `${target.hostname} has no A/AAAA record pointing to ${server.name} (${server.ip}). Nothing changed.`, currentRecords: current };
  }

  const removed: { id: string; type: string; content: string; action: "deleted" | "value_removed" }[] = [];
  for (const r of matches) {
    const values = contentValues(r.content);
    const remaining = values.filter((v) => !sameIp(v, server.ip));
    const action = remaining.length > 0 ? "value_removed" : "deleted";
    if (!opts.dryRun) {
      try {
        if (action === "deleted") {
          await deleteRecordById(target.provider, target.zone.id, target.zone.name, r.id, { before: r });
        } else {
          await updateExistingRecord(target.provider, target.zone.id, target.zone.name, r.id, {
            type: r.type,
            name: target.provider.type === "cloudflare" ? target.hostname : target.host,
            content: remaining.join(", "),
            ttl: r.ttl,
          }, { before: r });
        }
      } catch (e) {
        throw new BindingError(
          `Failed to remove record ${r.id}: ${e instanceof Error ? e.message : String(e)}` +
            (removed.length ? ` (already removed: ${removed.map((x) => x.id).join(", ")})` : ""),
          502,
        );
      }
    }
    removed.push({ id: r.id, type: r.type, content: r.content, action });
  }
  return {
    ...base,
    removed,
    message: `${opts.dryRun ? "Would remove" : "Removed"} ${removed.length} record(s) on ${target.hostname} pointing to ${server.name} (${server.ip}).`,
  };
}

/**
 * Find the A/AAAA hostnames in ONE managed domain whose value is the given
 * IP (or the IP of the given server). Scoped to a single domain on purpose so
 * no single call has to read every record of every domain.
 */
export async function findBindings(opts: { server?: string; ip?: string; domain: string }) {
  let ip: string;
  let server: ServerEntry | null = null;
  if (opts.server) {
    server = await requireServer(opts.server);
    ip = server.ip;
  } else if (opts.ip) {
    ip = opts.ip.trim();
    if (!sameIp(ip, ip)) throw new BindingError(`Invalid IP address: ${opts.ip}`);
  } else {
    throw new BindingError("Provide either server or ip");
  }

  const { zone, provider } = await resolveDomain(opts.domain);
  let records: DnsRecord[];
  try {
    records = await listZoneRecords(provider, zone.id, zone.name);
  } catch (e) {
    throw new BindingError(`Failed to fetch records for ${zone.name}: ${e instanceof Error ? e.message : String(e)}`, 502);
  }
  const bindings = records
    .filter((r) => recordPointsTo(r, ip))
    .map((r) => {
      const v = toRecordView(r, zone.name);
      return {
        hostname: v.hostname,
        type: v.type,
        content: v.content,
        ttl: v.ttl,
        recordId: v.id,
        ...(v.line ? { line: v.line } : {}),
        ...(v.proxied !== undefined ? { proxied: v.proxied } : {}),
      };
    })
    .sort((a, b) => a.hostname.localeCompare(b.hostname));

  return {
    ...(server ? { server: { name: server.name, ip: server.ip } } : { ip }),
    domain: zone.name,
    zoneId: zone.id,
    provider: provider.name,
    providerType: provider.type,
    bindings,
  };
}
