# HuddleTab V1 Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver HuddleTab / 伙记 V1 as a reliable, mobile-first, self-hosted expense-splitting PWA while preserving the confirmed accounting, permission, offline, and deployment boundaries.

**Architecture:** Build one Next.js modular monolith backed by PostgreSQL. Keep Money, Splitting, Ledger, and Settlement Recommendation as pure TypeScript modules; use server application services for authorization and transactions; use IndexedDB only for snapshots and pending offline expense creation.

**Tech Stack:** Node.js 24 LTS, npm, Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui, Better Auth, Drizzle ORM, PostgreSQL 18, Vitest, fast-check, Testcontainers, Playwright, idb, Serwist, Docker Compose.

---

## Confirmed implementation assumptions

1. Use **npm** so the project needs no package-manager bootstrap beyond the Node.js image.
2. Use **Node.js 24 LTS** for local tooling and the App container.
3. Use **PostgreSQL 18** and track current minor updates through the `postgres:18-alpine` image tag.
4. The App listens on `0.0.0.0:5660`; Compose exposes `5660:5660`.
5. Use `postgres.js` as the single PostgreSQL driver for Drizzle, services, migrations, and tests; run integration tests against ephemeral PostgreSQL 18 containers.
6. Pin JavaScript dependency resolution through committed `package-lock.json`; do not hand-write floating version numbers into deployment docs.
7. Use Better Auth's Drizzle adapter and username plugin, while retaining the confirmed Synthetic Email Compatibility Layer.
8. Use Serwist only for App Shell/static-resource caching and controlled update activation; business sync remains in the foreground app.
9. Use `idb` as a thin typed IndexedDB wrapper. Do not add Dexie Cloud or any second sync engine.
10. Keep one production Compose file with only `app` and `postgres` services.
11. For V1 exchange conversion, apply round-half-up once at the Expense total boundary, then distribute base-currency minor units deterministically by ActivityMember ID; never round each row independently.

## Official references checked on 2026-08-23

- Next.js App Router installation: https://nextjs.org/docs/app/getting-started/installation
- Next.js Node/Docker deployment: https://nextjs.org/docs/app/getting-started/deploying
- Better Auth Next.js integration: https://better-auth.com/docs/integrations/next
- Better Auth username plugin: https://better-auth.com/docs/plugins/username
- Better Auth Drizzle adapter: https://better-auth.com/docs/adapters/drizzle
- Drizzle migration generation: https://orm.drizzle.team/docs/drizzle-kit-generate
- shadcn CLI: https://ui.shadcn.com/docs/cli
- Vitest: https://vitest.dev/guide/
- fast-check with Vitest: https://fast-check.dev/docs/tutorials/setting-up-your-test-environment/property-based-testing-with-vitest/
- Playwright: https://playwright.dev/docs/intro
- PostgreSQL support policy: https://www.postgresql.org/support/versioning/
- Serwist Next.js integration: https://serwist.pages.dev/docs/next/getting-started
- Serwist controlled updates: https://serwist.pages.dev/docs/window
- `idb`: https://github.com/jakearchibald/idb
- PostgreSQL Testcontainers: https://node.testcontainers.org/modules/postgresql/

## Plan pack and dependency order

| Order | Plan | Delivers | Depends on |
|---:|---|---|---|
| 0 | `2026-08-23-huddletab-phase-0-foundation.md` | Runnable Next.js app, tests, DB, Docker, design tokens | Design Spec |
| 1 | `2026-08-23-huddletab-phase-1-money-domain.md` | Currency, Money, rate, split, ledger, recommendation | Phase 0 |
| 2 | `2026-08-23-huddletab-phase-2-auth.md` | Better Auth, username, Synthetic Email, setup, system roles | Phase 0 |
| 3 | `2026-08-23-huddletab-phase-3-activity-member.md` | Activities, members, invitations, lifecycle, permission invariants | Phases 1–2 |
| 4 | `2026-08-23-huddletab-phase-4-expense.md` | Expense facts, exchange rates, audit, optimistic locking | Phases 1–3 |
| 5 | `2026-08-23-huddletab-phase-5-ledger-settlement.md` | Dynamic balances, recommendations, actual Settlement | Phases 1–4 |
| 6 | `2026-08-23-huddletab-phase-6-core-ui.md` | Mobile-first product UI and dark mode | Phases 2–5 |
| 7 | `2026-08-23-huddletab-phase-7-offline.md` | IndexedDB snapshots, pending mutations, idempotent sync | Phases 4–6 |
| 8 | `2026-08-23-huddletab-phase-8-notifications-attachments.md` | Notifications and secure image attachments | Phases 4–7 |
| 9 | `2026-08-23-huddletab-phase-9-admin.md` | Users, policy, storage and system information（SMTP/应用级备份还原取消） | Phases 2–8 |
| 10 | `2026-08-23-huddletab-phase-10-release.md` | Manifest, Serwist, production image, HTTPS docs, release gates | Phases 0–9 |

## Design Spec coverage map

| Design Spec section | Primary implementation plan |
|---|---|
| 1–5 Product, scope, runtime architecture | Roadmap + Phase 0 + Phase 10 |
| 6 Module map and dependency direction | Roadmap + Phase 0 |
| 7 Money, rate, split, ledger, recommendation | Phase 1 |
| 8.1 Auth and system tables | Phase 2 + Phase 9 |
| 8.2 Activities, members, invitations, preferences | Phase 3 |
| 8.3 Expense aggregate | Phase 4 |
| 8.4 Settlement | Phase 5 |
| 8.5 Attachments, notifications, audit | Phase 4 + Phase 8 |
| 8.6 Rate cache and system support data | Phase 4 + Phase 9 |
| 9 Transaction boundaries | Phases 3–5 + Phase 9 |
| 10 API conventions and resource routes | Phases 2–9 |
| 11 Permission model and LEFT constraints | Phase 3 + Phase 5 |
| 12 Activity lifecycle | Phase 3 |
| 13 PWA and offline flow | Phase 7 + Phase 10 |
| 14 UI/UX specification | Phase 6 |
| 15 Notifications, attachments, summary, CSV, Me | Phase 6 + Phase 8 + Phase 9 |
| 16 Operations, migration, host data protection, HTTPS | Phase 9 + Phase 10 |
| 17 Security design | Phases 0, 2–5, 8–10 |
| 18 Chinese comments and understandable logs | Every phase |
| 19 Test strategy and acceptance evidence | Every phase; final consolidation in Phase 10 |
| 20 Risk controls | The phase that owns each risk, verified again in Phase 10 |
| 21–22 Stage order and frozen design checks | Roadmap and final plan-pack review |
## Global file responsibility map

```text
src/app/                         Routing and server-rendered page composition only
src/features/                    Feature-specific UI, DTOs, client state and use-case adapters
src/domain/                      Pure accounting rules; no framework or database imports
src/server/auth/                 Better Auth and Compatibility Layer
src/server/db/                   Drizzle schema, connection and migration runner
src/server/repositories/         Persistence-only adapters
src/server/services/             Transactions and application use cases
src/server/permissions/          Fixed authorization decision order
src/server/validation/           Zod request/response schemas
src/server/jobs/                 In-process cleanup tasks
src/pwa/indexed-db/              Typed IndexedDB schema and migrations
src/pwa/sync-queue/              Foreground queue and retry state machine
src/pwa/service-worker/          Serwist source and registration/update bridge
src/components/ui/               shadcn-generated primitives
src/components/design-system/    HuddleTab tokens and composed controls
tests/unit/                      Pure domain and utility tests
tests/integration/               PostgreSQL-backed service and repository tests
tests/api/                       Route-level authorization and error-contract tests
tests/e2e/                       Playwright user and offline flows
```

## Cross-phase invariants

Every phase must preserve these rules:

- Formal money uses `BIGINT`/`bigint`/API `string`.
- ActivityMember is the accounting identity.
- Expense/Payment/Share and Settlement are facts.
- Ledger and recommendations are calculated, never directly edited.
- Offline Queue is pending data, not a second ledger.
- Server Domain is authoritative.
- Permission order is Session → membership exists → activity state → member state → role → ownership → operation.
- `OWNER_TRANSFER_REQUIRED` and `LAST_ACTIVE_ADMIN` are transaction-layer invariants.
- Every key class and non-obvious algorithm receives Chinese design comments.
- User-facing errors and deployment logs use clear Chinese messages plus stable machine codes.

## Verification gates

Before starting the next phase:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
```

From Phase 6 onward also run:

```bash
npm run test:e2e
```

A phase is not complete until its own acceptance tests pass, generated migrations are committed, and `git status --short` is empty.
