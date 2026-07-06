import type { DnsRecord } from "./types.js";

/**
 * Export DNS records as a JSON string.
 * Preserves all fields (proxied, line, weight, status, comment) for round-tripping.
 */
export function toJson(records: DnsRecord[], zoneName: string): string {
  // Strip the `id` field — it's provider-specific and not portable
  const portable = records.map(({ id: _id, ...rest }) => rest);
  return JSON.stringify({ zone: zoneName, records: portable }, null, 2);
}

/**
 * Export DNS records as a BIND zone file.
 * Non-standard fields (proxied, line, weight, status) are omitted.
 * Cloudflare proxied records get a comment hint.
 */
export function toZoneFile(records: DnsRecord[], zoneName: string): string {
  const lines: string[] = [
    `; Zone: ${zoneName}`,
    `; Exported from Dotnify`,
    `; ${new Date().toISOString()}`,
    "",
    `$ORIGIN ${zoneName}.`,
    "",
  ];

  for (const r of records) {
    // Skip record types that don't belong in a zone file
    if (r.type === "SOA") continue;

    const name = fqdn(r.name, zoneName);
    const ttl = r.ttl;
    const cls = "IN";

    if (r.type === "MX") {
      const pri = r.priority ?? 10;
      lines.push(`${name}\t${ttl}\t${cls}\tMX\t${pri} ${r.content}.`);
    } else if (r.type === "SRV") {
      // SRV content in dotnify: "priority weight port target"
      // Zone file SRV rdata is the same format, just ensure target has trailing dot
      const parts = r.content.split(/\s+/);
      if (parts.length >= 4) {
        const target = parts[3].endsWith(".") ? parts[3] : `${parts[3]}.`;
        lines.push(`${name}\t${ttl}\t${cls}\tSRV\t${parts[0]} ${parts[1]} ${parts[2]} ${target}`);
      } else {
        lines.push(`${name}\t${ttl}\t${cls}\tSRV\t${r.content}`);
      }
    } else if (r.type === "TXT") {
      // Ensure TXT values are quoted and internal quotes are escaped
      let val = r.content;
      // Escape any unescaped double quotes inside the value
      val = val.replace(/(?<!\\)"/g, '\\"');
      // Wrap in quotes
      val = `"${val}"`;
      lines.push(`${name}\t${ttl}\t${cls}\tTXT\t${val}`);
    } else if (r.type === "CNAME" || r.type === "NS" || r.type === "PTR") {
      lines.push(`${name}\t${ttl}\t${cls}\t${r.type}\t${r.content}.`);
    } else if (r.type === "CAA") {
      lines.push(`${name}\t${ttl}\t${cls}\tCAA\t${r.content}`);
    } else {
      // A, AAAA, and others — content as-is
      lines.push(`${name}\t${ttl}\t${cls}\t${r.type}\t${r.content}`);
    }

    // Cloudflare proxied hint
    if (r.proxied) {
      lines[lines.length - 1] += "  ; proxied=true";
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Export DNS records as CSV.
 * Standard columns: type, name, content, ttl
 * Extended columns: priority, proxied, line, weight
 */
export function toCsv(records: DnsRecord[], _zoneName: string): string {
  const header = "type,name,content,ttl,priority,proxied,line,weight";
  const rows = records.map((r) =>
    [
      r.type,
      csvEscape(r.name),
      csvEscape(r.content),
      r.ttl,
      r.priority ?? "",
      r.proxied ? "true" : "",
      r.line ?? "",
      r.weight ?? "",
    ].join(",")
  );
  return [header, ...rows].join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a short name (@, subdomain) to a fully-qualified domain name. */
function fqdn(name: string, zoneName: string): string {
  if (name === "@") return `${zoneName}.`;
  if (name.endsWith(".")) return name;
  // If the name already contains the zone suffix, just add trailing dot
  if (name.endsWith(`.${zoneName}`)) return `${name}.`;
  return `${name}.${zoneName}.`;
}

/** Escape a value for CSV — quote if it contains commas, quotes, or newlines. */
function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
