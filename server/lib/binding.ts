/**
 * Server ⇄ hostname lookup logic (which hostnames point at a server), used by the REST API.
 *
 * "Binding" server X to a hostname means making sure the hostname has an
 * A (IPv4) or AAAA (IPv6) record pointing at the server's IP, via whichever
 * DNS provider manages the hostname's zone.
 */
import {
  listAllZones,
  listZoneRecords,
  loadProviders,
  normalizeRecordName,
  type ZoneWithProvider,
} from "./dns.js";
import { findServer, listServers, sameIp } from "./servers.js";
import type { DnsRecord, Provider, ServerEntry } from "./types.js";

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
