import { readFile } from "node:fs/promises";

import { expect, it } from "vitest";

it("生产镜像使用 Next standalone server 并在启动前执行原生迁移", async () => {
  const [dockerfile, entrypoint, nextConfig] = await Promise.all([
    readFile("Dockerfile", "utf8"),
    readFile("docker/entrypoint.sh", "utf8"),
    readFile("next.config.ts", "utf8"),
  ]);

  expect(nextConfig).toContain('output: "standalone"');
  expect(dockerfile).toContain("COPY --from=build /app/.next/standalone ./");
  expect(dockerfile).toContain(
    "COPY --from=build /app/.next/static ./.next/static",
  );
  expect(dockerfile).toContain("COPY --from=build /app/public ./public");
  expect(dockerfile).toContain("HOSTNAME=0.0.0.0 PORT=5660");
  expect(dockerfile).not.toContain("COPY --from=build /app/node_modules");
  expect(dockerfile).not.toContain("postgresql-client-18");
  expect(entrypoint).toContain("node src/server/db/migrate.ts");
  expect(entrypoint).toContain("exec node server.js");
  expect(entrypoint).not.toContain("npm run db:migrate");
  expect(entrypoint).not.toContain("npm run start:container");
});
