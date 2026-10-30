# Bakulan WA — MVP Technical Design
**v0.1 — QR-Connect WhatsApp AI Automation Platform**
*Scope: single-founder buildable, cashflow-first, not the full 10-phase enterprise spec.*

---

## 0. Ground Rules for This Version

- **No official Meta Cloud API.** Onboarding is QR scan, like WhatsApp Web. This is the entire value proposition (instant activation vs. 3-day WABA approval) and it comes from an unofficial protocol library. This is a deliberate, disclosed risk — not an oversight.
- **Multi-tenant, but simple isolation** — row-level tenant_id scoping in Postgres, not separate DBs/schemas per tenant. Schema-per-tenant is over-engineering at your current scale and adds migration pain later, not less.
- **Single AI provider at launch**, wrapped behind a thin router interface so swapping later doesn't touch business logic.
- **Single payment gateway** (Midtrans), usage metered internally, invoiced against a prepaid balance.
- No Prometheus/Grafana/tracing stack yet. Structured logs + one health endpoint is enough until you have paying tenants generating real signal to act on.

---

## 1. Tech Stack (with reasoning)

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 20 LTS | Baileys (WA library) is JS/TS-native; no benefit to a second language |
| Language | TypeScript | Type safety matters more when you're AI-assisted and non-technical — catches mistakes before runtime |
| API framework | Fastify | Lower overhead than NestJS for one dev; plugin model is simple enough for Claude Code to extend safely without you needing to understand DI internals |
| WA protocol | `@whiskeysockets/baileys` | Actively maintained fork of the original Baileys; the de facto standard for unofficial WA automation in Node |
| ORM / DB | PostgreSQL 16 + Prisma | Prisma's schema file + generated types make AI-assisted schema changes far safer than raw SQL — migrations are declarative and reviewable |
| Queue / jobs | BullMQ + Redis | Handles message processing, retries, and rate limiting to Meta/AI providers without blocking the WA socket thread |
| AI Router | Custom thin wrapper (no framework) | One function: `route(tenantId, messages) -> response`. Launch with **DeepSeek** (cheapest per-token, good enough for chat) or Qwen via Dashscope (you already have this integration from SMA — reuse it) |
| Frontend | Next.js 14 (App Router) + Tailwind + shadcn/ui | You already have design-system familiarity from Sigma/Rivalisme landing pages; shadcn keeps components consistent without a designer |
| Auth | JWT (access + refresh rotation), argon2 for password hashing | Standard, no need for a third-party auth provider yet — keep costs at zero |
| Payments | Midtrans Snap | Best fit for Indonesian UMKM: QRIS, VA, e-wallet in one integration, no monthly fee, pay-per-transaction only |
| Object storage | Alibaba Cloud OSS | You already have an Alibaba account from SMA/ECS — reuse the same billing relationship instead of adding AWS S3 |
| Reverse proxy / TLS | Caddy | Automatic HTTPS with zero config, far simpler than nginx + certbot for a solo dev |
| Deployment | Docker Compose, single VPS | You don't need Kubernetes at 0-500 tenants. Compose is enough and dramatically lower cognitive load |
| Process/session persistence | Baileys multi-file auth state, persisted to Postgres (encrypted) not local disk | Local disk dies with the container; DB-backed session state survives restarts/redeploys |
| Logging | Pino (structured JSON) | Cheap, fast, greppable; add a dashboard later once volume justifies it |

---

## 2. Architecture Diagram

```
                          ┌─────────────────────┐
                          │   Next.js Dashboard  │
                          │ (tenant onboarding,  │
                          │  QR display, wallet, │
                          │  persona builder)    │
                          └──────────┬───────────┘
                                     │ HTTPS (JWT)
                          ┌──────────▼───────────┐
                          │   Fastify API Server   │
                          │ ─────────────────────  │
                          │ /auth   /tenants        │
                          │ /wa     /persona        │
                          │ /billing /webhooks      │
                          └────┬───────────┬────────┘
                               │           │
                 ┌─────────────▼───┐   ┌───▼──────────────┐
                 │   PostgreSQL     │   │      Redis        │
                 │ (tenants, users, │   │ (BullMQ queues,    │
                 │  personas, wa    │   │  session cache,    │
                 │  sessions, wallet│   │  rate limiting)     │
                 │  ledger, msgs)   │   └───┬──────────────┘
                 └──────────────────┘       │
                                             │
                          ┌──────────────────▼───────────────────┐
                          │           WA Worker Process            │
                          │  ─────────────────────────────────    │
                          │  N Baileys socket instances            │
                          │  (1 per connected tenant number)       │
                          │  - QR generation on first connect      │
                          │  - auto-reconnect on drop              │
                          │  - incoming msg → enqueue to BullMQ    │
                          │  - outgoing msg ← dequeue from BullMQ  │
                          └──────────────────┬──────────────────┘
                                             │
                          ┌──────────────────▼──────────────────┐
                          │            AI Worker Process           │
                          │  ────────────────────────────────    │
                          │  dequeue message job                  │
                          │  → load tenant persona + short memory │
                          │  → call AI Router (provider swap-safe)│
                          │  → meter tokens → deduct wallet       │
                          │  → enqueue reply back to WA Worker    │
                          └──────────────────┬──────────────────┘
                                             │
                          ┌──────────────────▼──────────────────┐
                          │         External Providers            │
                          │  DeepSeek / Qwen (Dashscope) — AI      │
                          │  Midtrans — payment webhooks           │
                          │  Alibaba OSS — media storage            │
                          └───────────────────────────────────────┘
```

---

## 3. Core Flow

### 3.1 Onboarding (the part that replaces Meta's 3-day wait)

1. User signs up on dashboard (email + password → JWT issued).
2. User picks a persona template (or customizes one) and names their WA Business.
3. Dashboard calls `/wa/connect` → API creates a tenant WA session record → WA Worker spins up a new Baileys socket → QR code image streamed back to dashboard (via short-poll or WebSocket).
4. User scans QR with their WhatsApp app → Baileys fires `connection.update` with `open` status → session credentials (multi-file auth state) encrypted and persisted to Postgres.
5. Dashboard shows "Connected ✅" — **this whole flow should take under 60 seconds**, which is the entire pitch versus Meta's official onboarding.

### 3.2 Message handling

1. Customer messages the tenant's WA number → Baileys socket receives it → WA Worker pushes a job to BullMQ (`incoming-message` queue), tagged with `tenantId`.
2. AI Worker consumes the job → loads tenant's active persona config + last N messages (short-term memory, capped) → calls AI Router.
3. AI Router hits the configured provider (DeepSeek/Qwen), gets completion, returns `{ text, promptTokens, completionTokens }`.
4. Worker computes cost = `(promptTokens + completionTokens) × tenant_rate_per_token`, deducts from tenant wallet balance in a DB transaction (row lock to prevent race conditions on concurrent messages).
5. Reply enqueued to `outgoing-message` queue → WA Worker's Baileys socket sends it back to the customer.
6. If wallet balance hits zero mid-conversation → AI Worker short-circuits and sends a fallback "topup needed" message instead of calling the AI provider (never let tenant go negative).

### 3.3 Billing / topup

1. Tenant clicks "Top Up" on dashboard → API creates Midtrans Snap transaction → returns Snap token/URL.
2. Tenant pays via QRIS/VA/e-wallet.
3. Midtrans sends webhook to `/webhooks/midtrans` → API verifies signature → credits tenant wallet in Postgres.
4. Every AI call debits this same wallet at metered per-token rate + your margin.

### 3.4 Reconnect handling

- Baileys fires `connection.update` with disconnect reason on drop.
- If reason is `loggedOut` → mark session dead, prompt user to re-scan QR.
- Any other reason (network blip, restart) → auto-reconnect using persisted auth state, no user action needed.
- Cron/health-check job pings all active sockets every N minutes and alerts (to you, initially — not the tenant) if a tenant's session has been down > 15 minutes.

---

## 4. Directory Structure

```
bakulan-wa/
├── apps/
│   ├── api/                    # Fastify backend
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── tenants/
│   │   │   │   ├── persona/
│   │   │   │   ├── wa/            # WA connect/status endpoints
│   │   │   │   ├── billing/       # Midtrans + wallet ledger
│   │   │   │   └── webhooks/
│   │   │   ├── plugins/            # fastify plugins (auth, db, redis)
│   │   │   ├── lib/
│   │   │   └── server.ts
│   │   └── package.json
│   │
│   ├── wa-worker/              # Baileys socket manager
│   │   ├── src/
│   │   │   ├── sessions/           # per-tenant socket lifecycle
│   │   │   ├── queue/              # BullMQ producers/consumers
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── ai-worker/               # AI Router + persona/memory logic
│   │   ├── src/
│   │   │   ├── router/             # provider adapters (deepseek.ts, qwen.ts)
│   │   │   ├── memory/              # short-term context builder
│   │   │   ├── billing/             # token metering + wallet debit
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── web/                     # Next.js dashboard
│       ├── app/
│       │   ├── (auth)/
│       │   ├── dashboard/
│       │   ├── persona-builder/
│       │   └── billing/
│       └── package.json
│
├── packages/
│   ├── db/                       # Prisma schema + generated client
│   │   ├── prisma/schema.prisma
│   │   └── src/
│   ├── shared-types/              # shared TS types across apps
│   └── config/                    # shared env/config loader
│
├── docker/
│   ├── docker-compose.yml
│   ├── Dockerfile.api
│   ├── Dockerfile.wa-worker
│   ├── Dockerfile.ai-worker
│   └── Dockerfile.web
│
├── scripts/
│   ├── migrate.sh
│   └── seed.sh
│
├── docs/
│   └── (this file, ADRs, runbook)
│
├── .github/workflows/
│   └── ci.yml                     # lint + test on push, no CD yet
│
├── .env.example
├── turbo.json                      # or nx.json — monorepo task runner
└── package.json
```

This is a **monorepo** (Turborepo recommended — lighter than Nx, easier for AI-assisted dev to reason about) with 4 deployable apps and 3 shared packages. Deliberately flat — no `libs/billing`, `libs/ai`, `libs/wa` split into 15 packages like the original enterprise spec. You can split further once a module actually outgrows its folder.

---

## 5. Core Database Schema (essential tables only)

```
tenants
  id (uuid, pk)
  business_name
  owner_user_id (fk -> users)
  status (active|suspended)
  created_at, updated_at, deleted_at

users
  id (uuid, pk)
  email (unique)
  password_hash
  created_at, updated_at

wa_sessions
  id (uuid, pk)
  tenant_id (fk, indexed)
  phone_number
  status (pending_qr|connected|disconnected|logged_out)
  auth_state (encrypted bytea)
  last_connected_at
  created_at, updated_at

personas
  id (uuid, pk)
  tenant_id (fk, indexed)
  name
  system_prompt
  ai_provider (default: deepseek)
  is_active

messages
  id (uuid, pk)
  tenant_id (fk, indexed)
  wa_session_id (fk)
  direction (in|out)
  content
  prompt_tokens
  completion_tokens
  created_at

wallet_ledger
  id (uuid, pk)
  tenant_id (fk, indexed)
  type (topup|debit|refund)
  amount (decimal, IDR)
  balance_after (decimal)
  reference_id (midtrans order_id or message_id)
  created_at

midtrans_transactions
  id (uuid, pk)
  tenant_id (fk)
  order_id (unique)
  gross_amount
  status
  raw_webhook_payload (jsonb)
  created_at
```

Indexes: every `tenant_id` foreign key column, plus `wa_sessions.phone_number` (unique), `midtrans_transactions.order_id` (unique). Soft delete (`deleted_at`) on `tenants` and `users` only — messages/ledger are append-only, never deleted.

---

## 6. Key Dependencies (package.json level)

```json
{
  "dependencies": {
    "@whiskeysockets/baileys": "^6.x",
    "fastify": "^5.x",
    "@fastify/jwt": "^9.x",
    "@fastify/cors": "^10.x",
    "@fastify/helmet": "^12.x",
    "@prisma/client": "^6.x",
    "bullmq": "^5.x",
    "ioredis": "^5.x",
    "argon2": "^0.4x",
    "midtrans-client": "^1.4.x",
    "pino": "^9.x",
    "zod": "^3.x"
  },
  "devDependencies": {
    "prisma": "^6.x",
    "typescript": "^5.x",
    "vitest": "^2.x",
    "tsx": "^4.x"
  }
}
```

Frontend adds: `next`, `tailwindcss`, `shadcn-ui` components as needed, `zustand` (simple client state, no need for Redux at this scale).

---

## 7. CAPEX / OPEX Estimate

**Important:** for this architecture, there's almost no real CAPEX (no hardware purchase needed — you're not self-hosting AI, and WA sessions run fine on a small VPS). This is closer to a $50–100/month OPEX business than a capital-intensive one. Numbers below in IDR and USD (reference rate: **1 USD ≈ Rp17,900**, July 2026 — fluctuates, treat as approximate).

| Item | Monthly Cost (est.) | Notes |
|---|---|---|
| VPS / Compute (Alibaba ECS, 2 vCPU / 4GB, Singapore) | Rp 250,000 – 450,000 (~$14–25) | You already have an Alibaba account from SMA deployment — reuse billing, no new vendor onboarding |
| Managed Postgres (or self-hosted on same VPS) | Rp 0 (self-hosted) or Rp 300,000+ (~$17) managed | Start self-hosted on the same VPS to keep cost at zero; move to managed once you have paying tenants and can't afford downtime risk |
| Redis (self-hosted on same VPS) | Rp 0 | Runs fine on the same box at MVP scale |
| Domain (.com or .id) | ~Rp 150,000–250,000/**year** (~$8–14/yr) | One-time annual, negligible |
| SSL (Caddy + Let's Encrypt) | Rp 0 | Free, automatic |
| Object storage (Alibaba OSS) | Rp 20,000–50,000 (~$1–3) | Only pay for what media you store; negligible at low volume |
| Midtrans | Rp 0 fixed | No monthly fee — per-transaction MDR only (~0.7% for QRIS per their published example) |
| AI provider (DeepSeek/Qwen) | **Usage-based COGS, not fixed cost** | Pay per token consumed by tenants; this scales with revenue, not a fixed monthly bill. Budget ~Rp 200,000–500,000 (~$11–28) as a buffer for your own testing before you have paying users |
| **Total fixed monthly (pre-revenue, testing phase)** | **~Rp 500,000 – 1,200,000 (~$28–67/month)** | |

**What this means practically:** you can bootstrap this entirely from pocket money — there's no server rack, no GPU purchase, no upfront license fee. The only real "capital" required is your own build time. The AI token cost is the one line that scales with usage, so it should be priced into your per-user rate with margin from day one (e.g., charge tenants 1.5–2x your actual per-token cost, so growth funds itself rather than draining you).

**One risk to budget for, not cost but liability:** if a tenant's WA number gets banned (unofficial protocol risk mentioned earlier), you may face refund/support costs — not infrastructure cost, but worth having a clear ToS clause on this so it's not an open-ended liability.

---

## 8. Suggested Build Order (compressed from 10 phases to 5)

1. **Foundation** — monorepo scaffold, Prisma schema, auth (signup/login/JWT), deploy skeleton to VPS via Docker Compose. Goal: you can log in on a live URL.
2. **WA Connect** — Baileys integration, QR flow, session persistence/reconnect. Goal: you personally can scan a QR and see "connected" in the dashboard.
3. **AI Reply Loop** — persona CRUD, AI Router (single provider), message queue wiring end-to-end. Goal: send a WA message to your test number, get an AI reply back automatically.
4. **Billing** — wallet ledger, Midtrans topup + webhook, token metering + deduction, zero-balance fallback. Goal: a real topup via QRIS actually credits the wallet and a message actually deducts from it.
5. **Polish for first real tenant** — basic error alerting to yourself, session health cron, ToS/disclosure page about the unofficial-protocol risk, simple onboarding copy. Goal: you'd trust a stranger to use this and pay you.

Each phase should end with something *you* can click through end-to-end — not a stack of unintegrated pieces.

---

*This document supersedes the original 16-section enterprise spec for MVP purposes. The full spec's ideas (multi-provider billing, observability stack, RBAC, audit tables, official Meta API tier) are not wrong — they're just Phase 2+ concerns, after Bakulan WA has proven it can make money with real tenants.*