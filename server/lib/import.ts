import type { RecordType } from "./types.js";

const VALID_TYPES = new Set<string>([
  "A", "AAAA", "CNAME", "TXT", "MX", "NS", "SRV", "CAA", "PTR", "URI",
]);

/** Result of parsing an import file. */
export interface ImportResult {
  records: ImportRecord[];
  errors: string[];
}

/** A DNS record parsed from import, without an `id` (assigned on creation). */
export interface ImportRecord {
  type: RecordType;
  name: string;
  content: string;
  ttl: number;
  proxied?: boolean;
  priority?: number;
  line?: string;
  weight?: number;
  comment?: string;
}

// ---------------------------------------------------------------------------
// JSON import
// ---------------------------------------------------------------------------

export function fromJson(content: string, zoneName: string): ImportResult {
  const errors: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { records: [], errors: ["Invalid JSON"] };
  }

  // Support both { zone, records: [...] } and bare [...]
  let raw: unknown[];
  if (Array.isArray(parsed)) {
    raw = parsed;
  } else if (parsed && typeof parsed === "object" && "records" in parsed) {
    const arr = (parsed as { records: unknown }).records;
    if (!Array.isArray(arr)) return { records: [], errors: ["'records' must be an array"] };
    raw = arr;
  } else {
    return { records: [], errors: ["Expected an array or { zone, records } object"] };
  }

  const records: ImportRecord[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") {
      errors.push(`Record #${i + 1}: not an object`);
      continue;
    }
    const r = item as Record<string, unknown>;

    if (!VALID_TYPES.has(String(r.type ?? ""))) {
      errors.push(`Record #${i + 1}: invalid or missing type "${r.type}"`);
      continue;
    }
    if (typeof r.name !== "string" || !r.name) {
      errors.push(`Record #${i + 1}: missing name`);
      continue;
    }
    if (r.content === undefined || r.content === null || String(r.content) === "") {
      errors.push(`Record #${i + 1}: missing content`);
      continue;
    }

    records.push({
      type: String(r.type) as RecordType,
      name: normalizeName(String(r.name), zoneName),
      content: String(r.content),
      ttl: typeof r.ttl === "number" ? r.ttl : 300,
      proxied: r.proxied === true ? true : undefined,
      priority: typeof r.priority === "number" ? r.priority : undefined,
      line: typeof r.line === "string" ? r.line : undefined,
      weight: typeof r.weight === "number" ? r.weight : undefined,
      comment: typeof r.comment === "string" ? r.comment : undefined,
    });
  }

  return { records, errors };
}

// ---------------------------------------------------------------------------
// Zone File import
// ---------------------------------------------------------------------------

export function fromZoneFile(content: string, zoneName: string): ImportResult {
  const errors: string[] = [];
  const records: ImportRecord[] = [];
  let origin = zoneName;
  let lastName = zoneName; // for blank-name inheritance
  let defaultTtl = 300; // $TTL default

  // Join continuation lines (parenthesized multi-line records)
  const joined = content.replace(/\([^)]*\)/g, (m) => m.replace(/\n/g, " "));

  for (const rawLine of joined.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";")) continue;

    // Directives
    if (line.startsWith("$ORIGIN")) {
      origin = line.slice(8).trim().replace(/\.$/, "");
      continue;
    }
    if (line.startsWith("$TTL")) {
      const val = parseInt(line.slice(5).trim(), 10);
      if (!isNaN(val) && val > 0) defaultTtl = val;
      continue;
    }
    if (line.startsWith("$INCLUDE") || line.startsWith("$GENERATE")) {
      continue; // skip unsupported directives
    }

    // Tokenize — preserve quoted strings
    const tokens = tokenizeZoneLine(line);
    if (tokens.length < 4) continue; // need at least name ttl class type

    let idx = 0;

    // Name field — may be blank (inherits previous record's name)
    let name = tokens[idx];
    if (!isClass(name) && !isType(name)) {
      idx++;
      lastName = name;
    } else {
      name = lastName; // blank name field — inherit from previous
    }

    // Optional TTL (must be a number); fall back to $TTL default
    let ttl = defaultTtl;
    if (idx < tokens.length && /^\d+$/.test(tokens[idx])) {
      ttl = parseInt(tokens[idx], 10);
      idx++;
    }

    // Optional class (IN, CH, etc.)
    if (idx < tokens.length && isClass(tokens[idx])) {
      idx++;
    }

    // Type
    if (idx >= tokens.length) continue;
    const type = tokens[idx].toUpperCase();
    idx++;
    if (!VALID_TYPES.has(type)) continue; // skip unknown types like SOA

    // RDATA — everything remaining
    const rdata = tokens.slice(idx).join(" ");

    const normName = normalizeName(name, origin);
    const { content: normContent, priority } = parseRdata(type as RecordType, rdata, origin);

    records.push({
      type: type as RecordType,
      name: normName,
      content: normContent,
      ttl,
      priority,
    });
  }

  return { records, errors };
}

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

export function fromCsv(content: string, zoneName: string): ImportResult {
  const errors: string[] = [];
  const records: ImportRecord[] = [];

  // Strip UTF-8 BOM if present (common in Windows-exported CSV)
  const cleaned = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { records: [], errors: ["Empty CSV"] };

  // Parse header
  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
  const typeIdx = header.indexOf("type");
  const nameIdx = header.indexOf("name");
  const contentIdx = header.indexOf("content");
  const ttlIdx = header.indexOf("ttl");
  const priorityIdx = header.indexOf("priority");
  const proxiedIdx = header.indexOf("proxied");
  const lineIdx = header.indexOf("line");
  const weightIdx = header.indexOf("weight");

  if (typeIdx < 0 || nameIdx < 0 || contentIdx < 0) {
    return { records: [], errors: ["CSV must have at least type, name, content columns"] };
  }

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 3) continue;

    const type = (cols[typeIdx] ?? "").toUpperCase().trim();
    if (!VALID_TYPES.has(type)) {
      errors.push(`Row ${i + 1}: invalid type "${type}"`);
      continue;
    }

    const name = (cols[nameIdx] ?? "").trim();
    const rawContent = (cols[contentIdx] ?? "").trim();
    if (!name || !rawContent) {
      errors.push(`Row ${i + 1}: missing name or content`);
      continue;
    }

    const ttl = ttlIdx >= 0 ? parseInt(cols[ttlIdx], 10) : 300;
    const priority = priorityIdx >= 0 && cols[priorityIdx] ? parseInt(cols[priorityIdx], 10) : undefined;
    const proxied = proxiedIdx >= 0 && cols[proxiedIdx]?.toLowerCase() === "true" ? true : undefined;
    const line = lineIdx >= 0 && cols[lineIdx] ? cols[lineIdx].trim() : undefined;
    const weight = weightIdx >= 0 && cols[weightIdx] ? parseInt(cols[weightIdx], 10) : undefined;

    records.push({
      type: type as RecordType,
      name: normalizeName(name, zoneName),
      content: rawContent,
      ttl: isNaN(ttl) ? 300 : ttl,
      priority: priority !== undefined && !isNaN(priority) ? priority : undefined,
      proxied,
      line,
      weight: weight !== undefined && !isNaN(weight) ? weight : undefined,
    });
  }

  return { records, errors };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Normalize a record name: @ → zoneName, strip trailing dot, strip zone suffix. */
function normalizeName(name: string, zoneName: string): string {
  let n = name.trim();
  // Remove trailing dot (FQDN)
  if (n.endsWith(".")) n = n.slice(0, -1);
  // @ means zone apex
  if (n === "@") return "@";
  // Strip zone suffix if present (e.g. www.example.com → www)
  if (n === zoneName) return "@";
  const suffix = `.${zoneName}`;
  if (n.endsWith(suffix)) n = n.slice(0, -suffix.length);
  return n;
}

/** Parse RDATA based on record type, stripping trailing dots from domain names. */
function parseRdata(type: RecordType, rdata: string, _origin: string): { content: string; priority?: number } {
  if (type === "MX") {
    // "10 mail.example.com." → priority + target
    const match = rdata.match(/^(\d+)\s+(.+)$/);
    if (match) {
      const priority = parseInt(match[1], 10);
      let target = match[2].trim();
      if (target.endsWith(".")) target = target.slice(0, -1);
      return { content: target, priority };
    }
    return { content: rdata.replace(/\.$/, "") };
  }

  if (type === "SRV") {
    // Zone file SRV rdata: "priority weight port target"
    // dotnify stores the same format in content
    const match = rdata.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    if (match) {
      const priority = parseInt(match[1], 10);
      const weight = match[2];
      const port = match[3];
      let target = match[4].trim();
      if (target.endsWith(".")) target = target.slice(0, -1);
      return { content: `${priority} ${weight} ${port} ${target}`, priority };
    }
    return { content: rdata.trim() };
  }

  if (type === "CNAME" || type === "NS" || type === "PTR") {
    return { content: rdata.trim().replace(/\.$/, "") };
  }

  if (type === "TXT") {
    // Strip surrounding quotes if present
    let val = rdata.trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    }
    // Handle multiple concatenated quoted strings: "v=spf1" " include:..."
    val = val.replace(/"\s+"/g, "");
    return { content: val };
  }

  return { content: rdata.trim() };
}

function isClass(token: string): boolean {
  return token.toUpperCase() === "IN" || token.toUpperCase() === "CH" || token.toUpperCase() === "HS";
}

function isType(token: string): boolean {
  return VALID_TYPES.has(token.toUpperCase()) || token.toUpperCase() === "SOA";
}

/** Tokenize a zone file line, respecting quoted strings. */
function tokenizeZoneLine(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuote = !inQuote;
      current += ch;
    } else if (ch === " " || ch === "\t") {
      if (inQuote) {
        current += ch;
      } else if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      // Skip inline comments (outside quotes)
      if (!inQuote && ch === ";") break;
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

/** Parse a single CSV line, handling quoted fields. */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuote = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuote = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ",") {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}
