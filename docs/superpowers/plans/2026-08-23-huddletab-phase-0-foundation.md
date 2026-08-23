# HuddleTab Phase 0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a runnable, tested Next.js modular-monolith skeleton with the confirmed design tokens, PostgreSQL migration flow, and two-service Docker Compose deployment on port 5660.

**Architecture:** Manually scaffold the project in the existing non-empty repository, use npm and Node.js 24 LTS, place application code under `src/`, and establish test and database infrastructure before business modules.

**Tech Stack:** Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui, Vitest, Testing Library, Playwright, Drizzle ORM, postgres.js, PostgreSQL 18, Testcontainers, Docker Compose.

---

## File map

- Create: `package.json`, `package-lock.json`, `.nvmrc`, `.env.example`
- Create: `next-env.d.ts`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`
- Create: `vitest.config.ts`, `playwright.config.ts`, `drizzle.config.ts`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- Create: `src/components/design-system/app-shell.tsx`, `src/lib/cn.ts`
- Create: `drizzle/.gitkeep`, `src/server/db/client.ts`, `src/server/db/migrate.ts`, `src/server/db/schema/index.ts`
- Create: `src/app/api/health/route.ts`
- Create: `tests/unit/foundation/design-tokens.test.ts`
- Create: `tests/integration/foundation/database.test.ts`
- Create: `tests/e2e/foundation/app-shell.spec.ts`
- Create: `public/.gitkeep`, `Dockerfile`, `compose.yaml`, `.dockerignore`

### Task 1: Initialize npm and install the exact tool categories

- [ ] **Step 1: Create the npm manifest**

Run:

```bash
npm init -y
npm pkg set name=huddletab private=true type=module
npm pkg set engines.node=">=24 <25"
npm pkg set scripts.dev="next dev -p 5660"
npm pkg set scripts.build="next build"
npm pkg set scripts.start="next start -H 0.0.0.0 -p 5660"
npm pkg set scripts.lint="eslint ."
npm pkg set scripts.typecheck="tsc --noEmit"
npm pkg set scripts.test="vitest"
npm pkg set scripts.test:unit="vitest run tests/unit"
npm pkg set scripts.test:integration="vitest run tests/integration --maxWorkers=1"
npm pkg set scripts.test:e2e="playwright test"
npm pkg set scripts.db:generate="drizzle-kit generate"
npm pkg set scripts.db:migrate="tsx src/server/db/migrate.ts"
npm pkg set scripts.format:check="prettier --check ."
```

Expected: `package.json` contains the scripts above and no application dependencies yet.

- [ ] **Step 2: Install runtime dependencies**

Run:

```bash
npm install next@latest react@latest react-dom@latest drizzle-orm postgres better-auth zod react-hook-form @hookform/resolvers idb lucide-react clsx tailwind-merge class-variance-authority tw-animate-css server-only tsx
```

Expected: `package-lock.json` is created. Better Auth 的 Drizzle 适配器后续从 `better-auth/adapters/drizzle` 导入，不安装第二个适配器包。

- [ ] **Step 3: Install development dependencies**

Run:

```bash
npm install --save-dev typescript @types/node @types/react @types/react-dom eslint eslint-config-next prettier tailwindcss @tailwindcss/postcss drizzle-kit vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @fast-check/vitest fast-check @playwright/test @testcontainers/postgresql
```

- [ ] **Step 4: Record the Node major**

Create `.nvmrc`:

```text
24
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .nvmrc
git commit -m "chore: initialize Next.js dependencies"
```

### Task 2: Create the Next.js and TypeScript shell

- [ ] **Step 1: Write the failing shell test**

Create `tests/e2e/foundation/app-shell.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("shows the HuddleTab product shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "伙记" })).toBeVisible();
  await expect(page.getByText("一起花，清楚分。")).toBeVisible();
});
```

- [ ] **Step 2: Run the shell test and verify it fails**

```powershell
npx playwright install chromium
npm run test:e2e -- tests/e2e/foundation/app-shell.spec.ts
```

Expected: FAIL because the Next.js shell and configuration do not exist yet.

- [ ] **Step 3: Add framework configuration**

Create `next-env.d.ts`:

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// 此文件由 Next.js 类型系统使用，不应导入业务代码。
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "public/sw.js"]
}
```

Create `next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
};

export default nextConfig;
```

Create `postcss.config.mjs`:

```js
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

Create `eslint.config.mjs`:

```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([".next/**", "coverage/**", "playwright-report/**", "test-results/**"]),
]);
```

- [ ] **Step 4: Implement the shell**

Create `src/app/globals.css`:

```css
@import "tailwindcss";

body {
  margin: 0;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}
```

Create src/app/layout.tsx:

```tsx
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "伙记",
  title: { default: "伙记", template: "%s · 伙记" },
  description: "一起花，清楚分。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F8F7" },
    { media: "(prefers-color-scheme: dark)", color: "#0D1512" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
```

Create `src/app/page.tsx`:

```tsx
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-svh max-w-3xl flex-col justify-center px-4 py-12">
      <p className="text-sm font-semibold text-muted-foreground">HuddleTab</p>
      <h1 className="mt-2 text-4xl font-extrabold tracking-tight">伙记</h1>
      <p className="mt-3 text-lg text-muted-foreground">一起花，清楚分。</p>
    </main>
  );
}
```

- [ ] **Step 5: Configure Playwright and verify the test**

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: "http://127.0.0.1:5660", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5660",
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } }],
});
```

Run:

```bash
npx playwright install chromium
npm run test:e2e -- tests/e2e/foundation/app-shell.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add next-env.d.ts tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs playwright.config.ts src/app tests/e2e/foundation/app-shell.spec.ts
git commit -m "feat: add Next.js application shell"
```

### Task 3: Initialize shadcn and apply the confirmed design tokens

- [ ] **Step 1: Initialize shadcn non-interactively**

Run:

```bash
npx shadcn@latest init --template next --base radix --yes --css-variables --no-rtl --pointer
npx shadcn@latest add button dialog sheet tabs input label textarea select badge sonner dropdown-menu alert-dialog skeleton
```

- [ ] **Step 2: Write the token test**

Create `tests/unit/foundation/design-tokens.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("HuddleTab design tokens", () => {
  const css = readFileSync("src/app/globals.css", "utf8");

  it("contains the confirmed light and dark primary colors", () => {
    expect(css).toContain("#146B52");
    expect(css).toContain("#5DD6A7");
  });

  it("keeps a visible focus ring token", () => {
    expect(css).toContain("--ring:");
  });
});
```

- [ ] **Step 3: Configure Vitest**

Create `vitest.config.ts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    restoreMocks: true,
    clearMocks: true,
    coverage: { provider: "v8", reporter: ["text", "html"] },
  },
});
```

- [ ] **Step 4: Run the token test and verify it fails**

```powershell
npm run test:unit -- tests/unit/foundation/design-tokens.test.ts
```

Expected: FAIL because the generated theme does not contain the confirmed `#146B52` and `#5DD6A7` pair.

- [ ] **Step 5: Replace generated theme values with HuddleTab semantics**

Ensure `src/app/globals.css` contains:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

:root {
  --background: #f6f8f7;
  --foreground: #17211d;
  --card: #ffffff;
  --card-foreground: #17211d;
  --popover: #ffffff;
  --popover-foreground: #17211d;
  --primary: #146b52;
  --primary-foreground: #ffffff;
  --secondary: #eaf2ee;
  --secondary-foreground: #17211d;
  --muted: #eaf2ee;
  --muted-foreground: #56675f;
  --accent: #eaf2ee;
  --accent-foreground: #146b52;
  --destructive: #c93636;
  --border: #dce5e0;
  --input: #dce5e0;
  --ring: #146b52;
  --radius: 0.75rem;
}

.dark {
  --background: #0d1512;
  --foreground: #f1f7f4;
  --card: #14201b;
  --card-foreground: #f1f7f4;
  --popover: #14201b;
  --popover-foreground: #f1f7f4;
  --primary: #5dd6a7;
  --primary-foreground: #062017;
  --secondary: #1b2b24;
  --secondary-foreground: #f1f7f4;
  --muted: #1b2b24;
  --muted-foreground: #a9bbb3;
  --accent: #1b2b24;
  --accent-foreground: #5dd6a7;
  --destructive: #ff7b7b;
  --border: #2a3b34;
  --input: #2a3b34;
  --ring: #5dd6a7;
}

@layer base {
  * { @apply border-border outline-ring/50; }
  body {
    @apply bg-background text-foreground antialiased;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  button, [role="button"] { touch-action: manipulation; }
  :focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .money { font-variant-numeric: tabular-nums; }
}
```

Run:

```bash
npm run test:unit -- tests/unit/foundation/design-tokens.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components.json src/app/globals.css src/components src/lib vitest.config.ts tests/unit/foundation/design-tokens.test.ts package.json package-lock.json
git commit -m "feat: establish HuddleTab design system"
```

### Task 4: Add PostgreSQL, Drizzle, migrations, and health checks

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/foundation/database.test.ts`:

```ts
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { createDatabaseClient } from "@/server/db/client";

let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
let sql: Sql;

describe("database foundation", () => {
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:18-alpine").start();
    ({ sql } = createDatabaseClient(container.getConnectionUri(), 1));
  }, 60_000);

  afterAll(async () => {
    await sql.end();
    await container.stop();
  });

  it("connects to PostgreSQL 18", async () => {
    const [result] = await sql<{ version: string }[]>`select version()`;
    expect(result.version).toContain("PostgreSQL 18");
  });
});
```

- [ ] **Step 2: Run the integration test and verify it fails**

```powershell
npm run test:integration -- tests/integration/foundation/database.test.ts
```

Expected: FAIL because the application database module and Drizzle configuration do not exist yet.

- [ ] **Step 3: Add Drizzle configuration**

Create `drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema/*.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgresql://huddletab:huddletab@localhost:5432/huddletab" },
  strict: true,
  verbose: true,
});
```

Create `src/server/db/client.ts`:

```ts
import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/** 测试和生产共用同一数据库工厂；它只建立连接，不承载事务或权限。 */
export function createDatabaseClient(connectionString: string, max = 10) {
  const sql = postgres(connectionString, { max });
  return { sql, db: drizzle(sql) };
}

const globalForDb = globalThis as unknown as { database?: ReturnType<typeof createDatabaseClient> };
const database = globalForDb.database ?? createDatabaseClient(process.env.DATABASE_URL ?? "");
if (process.env.NODE_ENV !== "production") globalForDb.database = database;
export const sql = database.sql;
export const db = database.db;
```

Create `src/server/db/schema/index.ts`:

```ts
// 各业务阶段在本目录增加 schema 文件；此入口只统一导出，不承载业务规则。
export {};
```

Create an empty tracked marker `drizzle/.gitkeep`, then create `src/server/db/migrate.ts`:

```ts
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sql } from "./client";

const migrationsFolder = resolve(process.cwd(), "drizzle");

try {
  if (!existsSync(join(migrationsFolder, "meta", "_journal.json"))) {
    console.info("当前版本尚无数据库迁移，已安全跳过");
  } else {
    await migrate(db, { migrationsFolder });
    console.info("数据库迁移完成");
  }
} catch (error) {
  console.error("数据库迁移失败，应用不会继续启动", error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
```

- [ ] **Step 4: Add the health route**

Create `src/app/api/health/route.ts`:

```ts
import { NextResponse } from "next/server";
import { sql } from "@/server/db/client";

export async function GET() {
  try {
    await sql`select 1`;
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json(
      { status: "error", message: "数据库连接不可用" },
      { status: 503 },
    );
  }
}
```

- [ ] **Step 5: Run the integration test**

```bash
npm run test:integration -- tests/integration/foundation/database.test.ts
```

Expected: PASS and the container reports PostgreSQL 18.

- [ ] **Step 6: Commit**

```bash
git add drizzle.config.ts drizzle src/server/db src/app/api/health tests/integration/foundation/database.test.ts
git commit -m "feat: add PostgreSQL and migration foundation"
```

### Task 5: Add Docker Compose on port 5660

- [ ] **Step 1: Create environment documentation**

Create `.env.example`:

```dotenv
DATABASE_URL=postgresql://huddletab:change-me@postgres:5432/huddletab
POSTGRES_DB=huddletab
POSTGRES_USER=huddletab
POSTGRES_PASSWORD=change-me
BETTER_AUTH_SECRET=replace-with-at-least-32-random-bytes
BETTER_AUTH_URL=http://localhost:5660
APP_BASE_URL=http://localhost:5660
DATA_DIR=/data
```

Create an empty tracked marker `public/.gitkeep` so Docker can copy `public/` before PWA assets exist.

- [ ] **Step 2: Create the production image**

Create `Dockerfile`:

```dockerfile
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/src/server/db ./src/server/db
RUN mkdir -p /data/uploads /data/backups
EXPOSE 5660
CMD ["sh", "-c", "npm run db:migrate && npm run start"]
```

Create `.dockerignore`:

```text
.git
.superpowers
.next
node_modules
test-results
playwright-report
coverage
.env*
!.env.example
```

- [ ] **Step 3: Create Compose**

Create `compose.yaml`:

```yaml
services:
  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-huddletab}
      POSTGRES_USER: ${POSTGRES_USER:-huddletab}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?请设置 POSTGRES_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-huddletab} -d ${POSTGRES_DB:-huddletab}"]
      interval: 5s
      timeout: 5s
      retries: 20

  app:
    build: .
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-huddletab}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-huddletab}
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:?请设置 BETTER_AUTH_SECRET}
      BETTER_AUTH_URL: ${BETTER_AUTH_URL:-http://localhost:5660}
      APP_BASE_URL: ${APP_BASE_URL:-http://localhost:5660}
      DATA_DIR: /data
    ports:
      - "5660:5660"
    volumes:
      - app-uploads:/data/uploads
      - app-backups:/data/backups
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:5660/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 20

volumes:
  postgres-data:
  app-uploads:
  app-backups:
```

- [ ] **Step 4: Verify production startup**

Run:

```bash
Copy-Item .env.example .env
docker compose config
docker compose up --build -d
docker compose ps
curl http://localhost:5660/api/health
```

Expected: both services are healthy and health returns `{"status":"ok"}`.

- [ ] **Step 5: Commit**

```bash
git add .env.example public/.gitkeep Dockerfile compose.yaml .dockerignore package.json package-lock.json
git commit -m "feat: add two-service Docker deployment"
```

### Task 6: Run the Phase 0 gate

- [ ] **Step 1: Run static checks**

```bash
npm run format:check
npm run lint
npm run typecheck
```

- [ ] **Step 2: Run tests**

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
```

- [ ] **Step 3: Build and inspect Docker**

```bash
npm run build
docker compose build
```

- [ ] **Step 4: Confirm architecture boundaries**

Run:

```bash
Get-ChildItem src -Directory | Select-Object -ExpandProperty Name
```

Expected names include `app`, `components`, `domain`, `features`, `pwa`, and `server`.

- [ ] **Step 5: Commit any verification-only fixes**

```bash
git add -A
git commit -m "chore: complete foundation verification"
```
