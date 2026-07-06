# Changelog

## v0.2.0 (2026-07-06)

### Features

- DNS record import and export
- Sliding session expiration

### Bug Fixes

- Show zone name instead of ID on Records page

### Documentation

- Add acknowledgement to LINUX DO community

### Infrastructure

- Remove release branch workflow; sync from main instead

## v0.1.0 (2026-07-04)

### Features

- Aggregate DNS management across Cloudflare, Huawei Cloud, and DNSPod
- Full DNS record CRUD: create, edit, delete records with support for A, AAAA, CNAME, MX, TXT, CAA, SRV, and more
- Provider management: add, edit, and remove providers with credential verification
- Zone filtering: select which zones to manage per provider
- Resolution line support: view and select resolution lines (线路) for Huawei Cloud and DNSPod
- Dark mode with VitePress-style appearance toggle
- i18n (Chinese / English) with VitePress-style language switcher
- SVG provider logos on zone cards and add-provider form
- Search and provider filter on domains page
- Browser page titles (e.g. "Dashboard | Dotnify", "example.com | Dotnify")

### Infrastructure

- Hono-based API backend with Upstash Redis for state storage
- Password-based admin authentication with scrypt hashing
- Redis-backed rate limiting on sensitive endpoints
- Security headers (X-Content-Type-Options, X-Frame-Options, etc.)
- Vercel Serverless deployment support
- Docker deployment support (linux/amd64 + linux/arm64)
- Self-hosting support via `npm start` (Node.js / Docker / Railway)

### Bug Fixes

- Vercel routing: API requests were served as HTML due to SPA fallback taking priority
- Vercel function: use named HTTP method exports for Node.js runtime
- Vercel function: use `createRequire` to load JSON without import attribute (Node.js 24)
- Limit username and password length to prevent scrypt DoS
- Replace in-memory rate limiter with Redis-backed implementation (ineffective on serverless)
- Use Redis `SET NX` to atomically create admin, prevent setup race condition
