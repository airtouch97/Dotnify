# DNS change log & restore

Every DNS record mutation made through Dotnify is recorded with a full
before/after snapshot, so any change can be reviewed and rolled back.

## What is logged

All record create / update / delete operations, regardless of where they come from:

- the web UI and REST API (`source: web`, actor = admin username)
- imports
- MCP tools (`source: mcp`, actor = token name, plus the token id)
- restores themselves (marked as a restore of the original entry)

Each entry stores: timestamp, domain, provider, action, the full record
**before** and **after**, source, actor, MCP token id (if any), client IP and
the operation name. Dry runs (MCP `dry_run: true`) are not logged.

## Backup before write

The entry is written to Redis with status `pending` **before** the provider
API is called. If that write fails, the change is aborted - Dotnify never
changes DNS without a backup. After the provider call the entry is updated
to `ok` (with the after snapshot) or `error` (with the error message).

## Storage

Uses the same Upstash Redis instance Dotnify already requires - no new
services or environment variables:

- `dotnify:dns_change:<id>` - JSON entry (no TTL)
- `dotnify:dns_changes` - list of ids, newest first, capped at 5000 entries;
  only entries beyond the cap are trimmed.

Works identically on Vercel and on the Node server (Docker / `npm start`).

## Restore

`POST /api/changes/:id/restore` (admin session required), or the **Restore**
button on the **Change history** page (`/changes`).

- create -> the created record is deleted
- update -> the record is put back to its before state
- delete -> the record is re-created

Before restoring, Dotnify compares the record's current state with the entry's
after snapshot. If someone changed it since, the API returns `409` with a list
of conflicts and the UI offers **Restore anyway** (`{"force": true}`).
A restore is itself logged, so it can be undone too.

## API

- `GET /api/changes?domain=&token=&cursor=&limit=` - list entries (newest first)
- `GET /api/changes/:id` - one entry
- `GET /api/changes/:id/restore-check` - dry conflict check for a restore
- `POST /api/changes/:id/restore` - body `{ "force"?: boolean }`

## Notes

- The client IP is taken from `x-forwarded-for` / `x-real-ip` (same as the
  existing rate limiter). Behind Vercel or a reverse proxy this is the real
  client IP; if the Node server is exposed directly, treat it as informational.
- The MCP access page shows each token's last-used time and IP and links to
  the changes made with that token, to help spot and revoke a leaked token.
