# Server IP table & IP usage

## Servers (`/servers`)

A small table of **named server IPs** (e.g. `Server A → 203.0.113.10`), stored in
Redis under `dotnify:servers` (same Upstash Redis as the rest of the app, no extra
setup).

- Names are unique (case-insensitive). IPv4 and IPv6 are validated and normalized;
  IPv4 servers correspond to `A` records, IPv6 to `AAAA`.
- Edit / delete are always visible on each row. `/servers?edit=<id>` opens a row's
  edit form directly (used by the IP usage page).
- Deleting a server only removes it from the table — DNS records are never touched.
- **Bound hostnames**: pick one domain to list the A/AAAA records in it that point
  to the server's IP. Only that one zone is read (no all-domain scan).

## IP usage (`/ips`)

Finds the IPs your A/AAAA records point to most, across all managed domains.

- The browser requests A/AAAA records **one domain per request** (3 in parallel,
  progress bar, automatic back-off on HTTP 429 from the global rate limit), so no
  single request has to read every zone.
- Records are grouped by IP; by default only IPs used by ≥ 2 records are shown
  (adjustable), with a text filter.
- Vercel edge addresses (`76.76.21.0/24`, `216.198.79.0/24`, `64.29.17.0/24`,
  `66.33.60.0/24`) and CNAMEs to `vercel-dns*.com` are excluded (counted, not
  listed), since they are shared hosting endpoints rather than your servers.
- Unnamed IPs can be named inline (adds them to the server table). Named IPs can be
  renamed inline, removed from the table (with confirmation), or opened in
  `/servers` to edit the IP / note. Duplicate names get a clear error.

## REST API

All endpoints use the existing admin session auth (`Authorization: Bearer <session>`).

| Method | Path | Description |
|---|---|---|
| GET | `/api/servers` | List servers |
| POST | `/api/servers` | Create `{ name, ip, note? }` (409 on duplicate name) |
| PATCH | `/api/servers/:id` | Update any of `{ name, ip, note }` (`note: ""` clears; 409 duplicate, 404 unknown) |
| DELETE | `/api/servers/:id` | Delete (DNS untouched) |
| GET | `/api/servers/:id/bindings?domain=` | Hostnames in **one** domain (name or zone id, required) pointing to the server |
| GET | `/api/zones/:zoneId/address-records?providerId=&zoneName=` | A/AAAA of one zone with Vercel flags (used by `/ips`) |

## Refactor note

The provider dispatch helpers that used to live inline in `server/routes/zones.ts`
(list zones/records, create/update/delete a record for Cloudflare, Huawei Cloud,
Tencent Cloud DNSPod and Alibaba Cloud) were moved **unchanged** into
`server/lib/dns.ts` so they can be shared. Record CRUD behavior is unchanged.
