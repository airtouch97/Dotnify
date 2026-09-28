<div align="center">

<img src="public/favicon.png" alt="dotnify" width="100" height="100" />

# dotnify

English | [简体中文](./README.zh-CN.md)

**A unified DNS management tool that aggregates domains from multiple DNS providers into a single interface.**

</div>

---

## Getting Started

**You can get started with Dotnify by following the guide in the [documentation](https://dotnify.js.org).**

## Features

- **Multi-provider** — Manage DNS records across all your providers in one place
- **Full DNS CRUD** — Create, edit, and delete A/AAAA/CNAME/TXT/MX/NS/SRV records
- **Password-protected** — Single admin account with scrypt-hashed credentials
- **Server IP table & IP usage** — Name your server IPs, see which hostnames point to them, and find the most-used IPs across all domains ([docs](docs/servers-and-ip-usage.md))
- **Fast and lightweight** — Vite + React frontend, Hono backend, Upstash Redis for storage

## Project Structure

```
├── server/                        # Backend (Hono)
│   ├── index.ts                   # Hono app definition (routes + static serving)
│   ├── start.ts                   # Server entry point (dotenv + serve)
│   ├── lib/
│   │   ├── auth.ts                # Password hashing (scrypt), session management
│   │   ├── binding.ts             # Which hostnames point to a server (per domain)
│   │   ├── aliyun.ts              # Alibaba Cloud DNS client (REST + AK/SK HMAC-SHA1 signing)
│   │   ├── cloudflare.ts          # Cloudflare API client (REST + Bearer token)
│   │   ├── huawei.ts              # Huawei Cloud DNS client (REST + AK/SK HMAC-SHA256 signing)
│   │   ├── huawei-line.ts         # Huawei Cloud resolution line data loader
│   │   ├── dnspod.ts              # DNSPod (Tencent Cloud) client (REST + TC3-HMAC-SHA256 signing)
│   │   ├── dns.ts                 # Provider-agnostic zone/record helpers (moved from routes/zones.ts)
│   │   ├── middleware.ts          # Auth middleware (Hono createMiddleware)
│   │   ├── redis.ts               # Upstash Redis client + key definitions
│   │   ├── response.ts            # JSON response helpers (ok, error, notFound, etc.)
│   │   ├── servers.ts             # Named server IP table (Redis) + IP validation
│   │   ├── vercel.ts              # Known Vercel edge IPs / CNAME targets (excluded on /ips)
│   │   └── types.ts               # Shared backend types (Provider, DnsRecord, etc.)
│   └── routes/
│       ├── auth.ts                # /api/auth/* (me, login, logout, setup)
│       ├── providers.ts           # /api/providers/* (CRUD, verify, zones)
│       ├── zones.ts               # /api/zones/* (list, lines, records CRUD, address-records)
│       └── servers.ts             # /api/servers/* (server IP table CRUD, bindings)
├── src/                           # Frontend (React + Vite)
│   ├── components/                # Reusable UI components
│   ├── hooks/                     # useAuth, useFetch (SWR-like with stale-while-revalidate)
│   ├── lib/                       # API client, types, constants
│   ├── pages/
│   │   ├── Home.tsx               # Dashboard with stats and domain overview
│   │   ├── Domains.tsx            # Domain list across all providers
│   │   ├── Records.tsx            # DNS record table + create/edit forms
│   │   ├── Providers.tsx          # Provider management (add, test, delete)
│   │   ├── Servers.tsx            # Server IP table (add, edit, delete, bound hostnames)
│   │   ├── IpUsage.tsx            # IP usage (per-domain scan, group by IP, name/rename inline)
│   │   ├── Login.tsx              # Login page
│   │   └── Setup.tsx              # Initial admin setup
│   ├── huawei_line.json           # Huawei Cloud resolution line data (static, ~300 entries)
│   ├── dnspod_line.json           # DNSPod resolution line translations (English → Chinese)
│   ├── router.tsx                 # React Router config with auth guards
│   └── App.tsx                    # Root component
├── scripts/
│   └── vite-plugin-dev-api.ts    # Vite plugin: mounts Hono app during dev
└── vite.config.ts                 # Vite config with dev API plugin
```

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, React Router 6, Tailwind CSS |
| Backend | Hono (Node.js) |
| Database | Upstash Redis |
| Build | Vite 5, TypeScript 5 |

## License

[AGPL-v3](./LICENSE)

## Acknowledgements

Thanks to the [LINUX DO](https://linux.do) community for their support and feedback.
