# MCP endpoint & MCP access page

Dotnify exposes a [Model Context Protocol](https://modelcontextprotocol.io) endpoint
so AI assistants (Claude, Cursor, …) can manage the server table and point
hostnames at servers.

Works on every supported deployment (Vercel serverless, Docker / `npm start`,
`npm run dev`): it is a plain Hono route using the official
`@modelcontextprotocol/sdk` Streamable HTTP transport in **stateless JSON mode**
(no sessions, no long-lived SSE streams). Storage is the existing Upstash Redis.

## Endpoint

`POST /api/mcp` with `Authorization: Bearer <token>`.

Accepted tokens:

1. Tokens generated on the **MCP access** page (`/mcp`), format `dtn_mcp_…`
   (256-bit random). Only `sha256(token)` is stored (`dotnify:mcp_tokens`); the
   plaintext is shown once at creation. Each token has a name, created time and
   last-used time (separate small key, written at most once a minute). Revoking
   takes effect immediately.
2. Optional fallback: the `MCP_TOKEN` environment variable.

With no app tokens and no `MCP_TOKEN`, every request gets `401`, so the endpoint
is effectively off until you create a token. `GET`/`DELETE` return 405 (stateless
server). CORS allows any origin (auth is a bearer header, not cookies) so
browser-based clients like MCP Inspector work.

## Tools

Tools are step-by-step: no tool reads the records of more than one domain per
call. Intended flow: `list_servers` → `list_domains` → `list_dns_records(domain)`
→ bind / unbind / find on that one domain.

| Tool | What it does |
|---|---|
| `list_servers` | List the server IP table |
| `add_server` | Add `name`, `ip`, `note?` (unique name, validated IPv4/IPv6) |
| `update_server` | Rename / change IP / change note (does not rewrite DNS) |
| `delete_server` | Remove a server from the table (does not touch DNS) |
| `list_domains` | All managed domains + provider + zone id (reads no records) |
| `list_dns_records` | Records of **one** `domain`, optional `host` / `type` filters |
| `bind_server_to_domain` | `domain` + `hostname` (`api`, `@` or FQDN) + target → create the A/AAAA record, or update the existing A/AAAA for that host. Target is `server` (existing name/id) **or** `ip` (a new IP also needs `server_name` and is added to the table in the same call). Refuses CNAME conflicts, ambiguous multi-record hosts (pass `record_id`) and FQDNs of another managed domain. Supports `ttl`, `proxied` (Cloudflare) and `dry_run` |
| `unbind_server_from_domain` | Delete the A/AAAA record(s) on a host pointing to the server's IP (others untouched). Supports `record_id`, `dry_run` |
| `find_server_bindings` | Hostnames in **one** `domain` pointing to a server (or raw `ip`) |

## REST API for tokens (admin session auth)

| Method | Path | Description |
|---|---|---|
| GET | `/api/mcp-tokens` | List tokens (no secrets/hashes) + whether `MCP_TOKEN` is set |
| POST | `/api/mcp-tokens` | Create `{ name }` → returns the plaintext token **once** |
| DELETE | `/api/mcp-tokens/:id` | Revoke |

## Client configuration

The `/mcp` page shows these snippets with your real endpoint and a freshly
generated token filled in. Replace `https://dotnify.example.com` with your host.

Cursor (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "dotnify": {
      "url": "https://dotnify.example.com/api/mcp",
      "headers": { "Authorization": "Bearer YOUR_MCP_TOKEN" }
    }
  }
}
```

Claude Code:

```bash
claude mcp add --transport http dotnify https://dotnify.example.com/api/mcp \
  --header "Authorization: Bearer YOUR_MCP_TOKEN"
```

Claude Desktop needs the `mcp-remote` bridge (connectors can't send custom headers);
the page shows the exact config.

## Security

An MCP token grants DNS write access to all managed domains. Give each client its
own token and revoke it on `/mcp` when no longer needed.
