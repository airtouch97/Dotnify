import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { listServers, createServer, updateServer, deleteServer, ServerTableError } from "./servers.js";
import { bindServer, unbindServer, findBindings, resolveDomain, toRecordView, BindingError } from "./binding.js";
import { listAllZones, listZoneRecords } from "./dns.js";

/**
 * Build the Dotnify MCP server (tools only). A fresh instance is created per
 * HTTP request (stateless Streamable HTTP), which suits serverless runtimes.
 *
 * Tools are deliberately step-by-step: no tool reads the records of more than
 * ONE domain per call. The LLM is guided to go
 *   list_domains → list_dns_records(domain) → bind/unbind/find (domain).
 */

const INSTRUCTIONS = `Dotnify manages DNS records for domains hosted at several DNS providers (Cloudflare, Tencent Cloud DNSPod, Huawei Cloud, Alibaba Cloud) and keeps a named "server IP table" that maps friendly server names (e.g. "服务器A", "web-1") to IP addresses.
Dotnify 管理多个 DNS 服务商下的域名解析，并维护一张"服务器 IP 表"（服务器名称 → IP）。

Work step by step / 请分步操作 — every DNS tool works on exactly ONE domain per call:
1. list_servers — resolve the server name the user mentioned (names are case-insensitive). 确认服务器。
2. list_domains — find the managed domain (zone) the hostname belongs to, e.g. "api.example.com" → domain "example.com". 找到所属主域名。
3. list_dns_records(domain, host?) — inspect what currently exists for that host. 查看现有记录。
4. Act on that one domain: bind_server_to_domain / unbind_server_from_domain / find_server_bindings. Use dry_run=true first when unsure. 再执行操作，可先 dry_run 预览。

Two common scenarios, fewest steps / 两个常见场景（最少步骤）:
(a) Change the IP of an existing hostname / 修改已有主机名的 IP: list_domains (if the domain isn't obvious) → list_dns_records(domain, host) to show the user the current IP → bind_server_to_domain with the new target. It updates the existing A/AAAA record in place.
(b) Create a new hostname pointing to an IP / 新建主机名指向某 IP: list_domains (if needed) → bind_server_to_domain.
The bind target can be a named server (server="服务器A") OR a raw IP (ip="1.2.3.4"). With ip: if the IP is already in the server table its name is used automatically; if it is new, also pass server_name and the server entry is created in the same call. If the user gave no name for a new IP, ask them or propose one — don't call add_server separately.

Examples / 示例:
- "把服务器A绑定到 api.example.com" → list_domains → bind_server_to_domain(server="服务器A", domain="example.com", hostname="api")
- "把 api.example.com 改成 1.2.3.4，叫它服务器B" → list_dns_records(domain="example.com", host="api") (show current IP) → bind_server_to_domain(ip="1.2.3.4", server_name="服务器B", domain="example.com", hostname="api")
- "新建 new.example.com 指向 5.6.7.8" (5.6.7.8 unnamed) → ask for / propose a name → bind_server_to_domain(ip="5.6.7.8", server_name="…", domain="example.com", hostname="new")
- "解绑 api.example.com 上的服务器A" → unbind_server_from_domain(server="服务器A", domain="example.com", hostname="api")
- "example.com 下有哪些解析到服务器A?" → find_server_bindings(server="服务器A", domain="example.com")
- "服务器A 绑定了哪些域名?" (no domain given) → list_domains, then call find_server_bindings once per relevant domain; ask the user which domains to check if there are many.
- "新增服务器B 1.2.3.4" (no hostname involved) → add_server(name="服务器B", ip="1.2.3.4")`;

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

/** Wrap a tool handler so known errors become MCP tool errors (isError). */
function safe<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return json(await fn(args));
    } catch (e) {
      if (e instanceof ServerTableError || e instanceof BindingError) return fail(e.message);
      console.error("[mcp] tool error:", e);
      return fail(e instanceof Error ? e.message : "Internal error");
    }
  };
}

const serverRef = z
  .string()
  .min(1)
  .describe('Server name (e.g. "服务器A", case-insensitive) or server id from list_servers. 服务器名称或 ID。');
const domainArg = z
  .string()
  .min(1)
  .describe('Managed domain (zone) exactly as returned by list_domains, e.g. "example.com" (or its zoneId). 主域名，取自 list_domains。');
const hostArg = z
  .string()
  .min(1)
  .describe('Host inside that domain: relative ("api", "@" for the apex) or fully-qualified ("api.example.com"). 主机记录，如 "api"、"@" 或完整域名。');
const dryRunArg = z
  .boolean()
  .optional()
  .describe("If true, only report what would change without modifying DNS. 为 true 时仅预览，不修改。");

export function buildMcpServer(): McpServer {
  const mcp = new McpServer(
    { name: "dotnify", version: "0.2.0" },
    { instructions: INSTRUCTIONS, capabilities: { tools: {} } },
  );

  // ── Server IP table ────────────────────────────────────────────────────────

  mcp.registerTool(
    "list_servers",
    {
      title: "List servers / 列出服务器",
      description:
        "Step 1 for binding tasks. List all named servers in the server IP table (name → IP, note). 列出服务器 IP 表中的所有服务器（名称、IP、备注）。",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    safe(async () => ({ servers: await listServers() })),
  );

  mcp.registerTool(
    "add_server",
    {
      title: "Add server / 新增服务器",
      description:
        'Add a named server to the server IP table. Names must be unique; IP must be a valid IPv4 or IPv6 address. Example: name="服务器A", ip="203.0.113.10". 新增服务器（名称唯一，IP 支持 IPv4/IPv6）。',
      inputSchema: {
        name: z.string().min(1).max(64).describe('Friendly unique server name, e.g. "服务器A". 服务器名称。'),
        ip: z.string().min(1).describe("IPv4 or IPv6 address. IP 地址。"),
        note: z.string().max(500).optional().describe("Optional note. 可选备注。"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    safe(async (args: { name: string; ip: string; note?: string }) => ({ created: await createServer(args) })),
  );

  mcp.registerTool(
    "update_server",
    {
      title: "Update server / 修改服务器",
      description:
        "Rename a server, change its IP, or change its note. Only provided fields change. NOTE: changing the IP does NOT update existing DNS records — check each domain with find_server_bindings and re-bind if needed. 修改服务器名称/IP/备注；修改 IP 不会自动更新已有解析记录。",
      inputSchema: {
        server: serverRef,
        new_name: z.string().min(1).max(64).optional().describe("New unique name. 新名称。"),
        ip: z.string().optional().describe("New IPv4/IPv6 address. 新 IP。"),
        note: z.string().max(500).optional().describe('New note ("" clears it). 新备注（空字符串清除）。'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    safe(async (args: { server: string; new_name?: string; ip?: string; note?: string }) => ({
      updated: await updateServer(args.server, { name: args.new_name, ip: args.ip, note: args.note }),
    })),
  );

  mcp.registerTool(
    "delete_server",
    {
      title: "Delete server / 删除服务器",
      description:
        "Remove a server from the server IP table. DNS records are NOT modified (use unbind_server_from_domain for that). 从服务器表删除服务器，不会修改 DNS 解析记录。",
      inputSchema: { server: serverRef },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    safe(async (args: { server: string }) => ({ deleted: await deleteServer(args.server) })),
  );

  // ── Domains & records ──────────────────────────────────────────────────────

  mcp.registerTool(
    "list_domains",
    {
      title: "List domains / 列出域名",
      description:
        'Step 2. List all managed domains (zones) with provider and zoneId. Does not read any records. Use it to map a hostname like "api.example.com" to its domain "example.com" before calling the per-domain tools. 列出所有已管理的域名（不读取记录），用于确定主机名所属的主域名。',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    safe(async () => {
      const { zones, errors } = await listAllZones();
      return {
        domains: zones.map((z) => ({
          domain: z.name,
          zoneId: z.id,
          status: z.status,
          provider: z.providerName,
          providerType: z.providerType,
        })),
        errors,
        next: "Pick the domain the user's hostname belongs to, then call list_dns_records(domain) or a bind/unbind/find tool with that domain.",
      };
    }),
  );

  mcp.registerTool(
    "list_dns_records",
    {
      title: "List DNS records of one domain / 列出单个域名的解析记录",
      description:
        'Step 3. List DNS records of ONE managed domain (from list_domains). Optional filters: host ("api", "@", or "api.example.com") and type. Check this before binding to see whether the host already has an A/AAAA or CNAME. 列出单个域名的解析记录，可按主机记录/类型过滤；绑定前先查看现有记录。',
      inputSchema: {
        domain: domainArg,
        host: z.string().optional().describe('Optional host filter: "@", "api", or "api.example.com". 可选主机记录过滤。'),
        type: z
          .enum(["A", "AAAA", "CNAME", "TXT", "MX", "NS", "SRV", "CAA", "PTR", "SOA", "SPF", "URI"])
          .optional()
          .describe("Optional record type filter. 可选记录类型过滤。"),
      },
      annotations: { readOnlyHint: true },
    },
    safe(async (args: { domain: string; host?: string; type?: string }) => {
      const { zone, provider } = await resolveDomain(args.domain);
      const records = (await listZoneRecords(provider, zone.id, zone.name)).map((r) => toRecordView(r, zone.name));
      let hostFilter: string | null = null;
      if (args.host) {
        const h = args.host.trim().toLowerCase().replace(/\.$/, "");
        const zn = zone.name.toLowerCase().replace(/\.$/, "");
        hostFilter = h === "@" || h === zn ? "@" : h.endsWith(`.${zn}`) ? h.slice(0, -(zn.length + 1)) : h;
      }
      const filtered = records.filter(
        (r) => (hostFilter === null || r.host === hostFilter) && (!args.type || r.type === args.type),
      );
      const limit = 500;
      return {
        domain: zone.name,
        zoneId: zone.id,
        provider: provider.name,
        providerType: provider.type,
        total: filtered.length,
        truncated: filtered.length > limit,
        records: filtered.slice(0, limit).map((r) => ({
          id: r.id,
          hostname: r.hostname,
          host: r.host,
          type: r.type,
          content: r.content,
          ttl: r.ttl,
          ...(r.proxied !== undefined ? { proxied: r.proxied } : {}),
          ...(r.priority !== undefined ? { priority: r.priority } : {}),
          ...(r.line ? { line: r.line } : {}),
          ...(r.status ? { status: r.status } : {}),
          ...(r.comment ? { comment: r.comment } : {}),
        })),
      };
    }),
  );

  // ── Binding (one domain per call) ──────────────────────────────────────────

  mcp.registerTool(
    "bind_server_to_domain",
    {
      title: "Bind server / IP to hostname / 绑定服务器或 IP 到域名",
      description:
        "Step 4. Point a host in ONE domain at a server — creates an A (IPv4) or AAAA (IPv6) record, or updates the existing A/AAAA record for that host (use this both to CHANGE a hostname's IP and to CREATE a new hostname). " +
        'Target: either server (existing name/id) OR ip. With ip: if the IP is already in the server table that server is used; if the IP is new you MUST also pass server_name, and the server entry is created in the same call (not on dry_run). If the user did not name a new IP, ask them or propose a name instead of calling add_server. ' +
        'Examples: "把服务器A绑定到 api.example.com" → server="服务器A", domain="example.com", hostname="api"; "把 api.example.com 改成 1.2.3.4，叫它服务器B" → ip="1.2.3.4", server_name="服务器B", domain="example.com", hostname="api" (call list_dns_records first to show the current IP). ' +
        "Get the domain from list_domains. Refuses if the host has a CNAME, or several A/AAAA records (pass record_id from list_dns_records). " +
        "将某域名下的主机解析到服务器或 IP：可传已有服务器名，或直接传 ip；ip 未命名时需同时传 server_name，会一并加入服务器表。已有记录则更新（改 IP），否则新建。",
      inputSchema: {
        domain: domainArg,
        hostname: hostArg,
        server: serverRef.optional(),
        ip: z.string().optional().describe("Target IPv4/IPv6 address (alternative to server). 目标 IP（可替代 server）。"),
        server_name: z
          .string()
          .max(64)
          .optional()
          .describe("Name for a NEW server entry when ip is not yet in the server table (required in that case; ignored if the IP is already named). ip 尚未命名时的新服务器名称。"),
        server_note: z.string().max(500).optional().describe("Optional note for the new server entry. 新服务器备注（可选）。"),
        ttl: z.number().int().min(1).max(86400).optional().describe("Optional TTL in seconds (default: provider default / keep existing). 可选 TTL。"),
        proxied: z.boolean().optional().describe("Cloudflare only: enable orange-cloud proxy (default false for new records). 仅 Cloudflare：是否开启代理。"),
        record_id: z.string().optional().describe("Optional: id (from list_dns_records) of the A/AAAA record to update when the host has several. 可选：指定要更新的记录 ID。"),
        dry_run: dryRunArg,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    safe(
      async (args: {
        domain: string;
        hostname: string;
        server?: string;
        ip?: string;
        server_name?: string;
        server_note?: string;
        ttl?: number;
        proxied?: boolean;
        record_id?: string;
        dry_run?: boolean;
      }) =>
        bindServer({
          server: args.server,
          ip: args.ip,
          serverName: args.server_name,
          serverNote: args.server_note,
          domain: args.domain,
          hostname: args.hostname,
          ttl: args.ttl,
          proxied: args.proxied,
          recordId: args.record_id,
          dryRun: args.dry_run,
        }),
    ),
  );

  mcp.registerTool(
    "unbind_server_from_domain",
    {
      title: "Unbind server from hostname / 解绑服务器",
      description:
        'Step 4. In ONE domain, delete the A/AAAA record(s) on a host that point to the given server\'s IP (records pointing elsewhere are left untouched). Example: "解绑 api.example.com 上的服务器A" → server="服务器A", domain="example.com", hostname="api". 删除某域名下该主机上指向该服务器 IP 的 A/AAAA 记录。',
      inputSchema: {
        server: serverRef,
        domain: domainArg,
        hostname: hostArg,
        record_id: z.string().optional().describe("Optional: only remove this record id. 可选：仅删除该记录。"),
        dry_run: dryRunArg,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    safe(async (args: { server: string; domain: string; hostname: string; record_id?: string; dry_run?: boolean }) =>
      unbindServer({ server: args.server, domain: args.domain, hostname: args.hostname, recordId: args.record_id, dryRun: args.dry_run }),
    ),
  );

  mcp.registerTool(
    "find_server_bindings",
    {
      title: "Find hostnames of a server in one domain / 查询服务器在某域名下的绑定",
      description:
        'Find the hostnames (A/AAAA records) in ONE managed domain that point to a server\'s IP. Give a server name/id or a raw ip, plus the domain (required). To answer "which hostnames point to 服务器A?" across several domains, call list_domains first and then call this once per domain (ask the user to narrow it down if there are many). 查找某个域名下解析到该服务器 IP 的主机名；跨多个域名时请先 list_domains，再逐个域名调用。',
      inputSchema: {
        domain: domainArg,
        server: serverRef.optional(),
        ip: z.string().optional().describe("Raw IPv4/IPv6 address (alternative to server). 或直接指定 IP。"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async (args: { domain: string; server?: string; ip?: string }) => findBindings(args)),
  );

  return mcp;
}
