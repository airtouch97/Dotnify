<div align="center">

<img src="public/favicon.png" alt="dotnify" width="100" height="100" />

# dotnify

[English](./README.md) | 简体中文

**一个 DNS 统一管理工具，把多个 DNS 供应商的域名聚合到同一个界面里。**

</div>

---

## 快速开始

**你可以按照在[文档](https://dotnify.js.org)中的指南开始使用 Dotnify。**

## 功能

- **多供应商** — 统一管理所有 DNS 供应商的记录
- **完整的 DNS CRUD** — 创建、编辑、删除 A/AAAA/CNAME/TXT/MX/NS/SRV 等记录
- **密码保护** — 单管理员账户，密码使用 scrypt 哈希存储
- **轻量快速** — Vite + React 前端，Hono 后端，Upstash Redis 存储

## 项目结构

```
├── server/                        # 后端（Hono）
│   ├── index.ts                   # Hono 应用定义（路由 + 静态文件服务）
│   ├── start.ts                   # 服务器入口（dotenv + serve）
│   ├── lib/
│   │   ├── auth.ts                # 密码哈希（scrypt）、会话管理
│   │   ├── aliyun.ts              # 阿里云 DNS 客户端（REST + AK/SK HMAC-SHA1 签名）
│   │   ├── cloudflare.ts          # Cloudflare API 客户端（REST + Bearer Token）
│   │   ├── huawei.ts              # 华为云 DNS 客户端（REST + AK/SK HMAC-SHA256 签名）
│   │   ├── huawei-line.ts         # 华为云解析线路数据加载
│   │   ├── dnspod.ts              # DNSPod（腾讯云）客户端（REST + TC3-HMAC-SHA256 签名）
│   │   ├── middleware.ts          # 鉴权中间件（Hono createMiddleware）
│   │   ├── redis.ts               # Upstash Redis 客户端 + 键名定义
│   │   ├── response.ts            # JSON 响应辅助（ok、error、notFound 等）
│   │   └── types.ts               # 后端共享类型（Provider、DnsRecord 等）
│   └── routes/
│       ├── auth.ts                # /api/auth/*（me、login、logout、setup）
│       ├── providers.ts           # /api/providers/*（CRUD、验证、zones）
│       └── zones.ts               # /api/zones/*（列表、线路、记录 CRUD）
├── src/                           # 前端（React + Vite）
│   ├── components/                # 可复用 UI 组件
│   ├── hooks/                     # useAuth、useFetch（类 SWR，stale-while-revalidate）
│   ├── lib/                       # API 客户端、类型、常量
│   ├── pages/
│   │   ├── Home.tsx               # 仪表盘，展示统计和域名概览
│   │   ├── Domains.tsx            # 所有供应商的域名列表
│   │   ├── Records.tsx            # DNS 记录表格 + 创建/编辑表单
│   │   ├── Providers.tsx          # 供应商管理（添加、测试连通性、删除）
│   │   ├── Login.tsx              # 登录页
│   │   └── Setup.tsx              # 初始管理员设置
│   ├── huawei_line.json           # 华为云解析线路数据（静态文件，约 300 条）
│   ├── dnspod_line.json           # DNSPod 解析线路翻译对照（英文 → 中文）
│   ├── router.tsx                 # React Router 配置，含鉴权守卫
│   └── App.tsx                    # 根组件
├── scripts/
│   └── vite-plugin-dev-api.ts    # Vite 插件：开发时挂载 Hono 应用
└── vite.config.ts                 # Vite 配置，含开发 API 插件
```

## 技术栈

| 层级 | 技术 |
|---|---|
| 前端 | React 18, React Router 6, Tailwind CSS |
| 后端 | Hono (Node.js) |
| 数据库 | Upstash Redis |
| 构建 | Vite 5, TypeScript 5 |

## 许可证

[AGPL-v3](./LICENSE)

## 致谢

感谢 [LINUX DO](https://linux.do) 社区的支持与反馈。
