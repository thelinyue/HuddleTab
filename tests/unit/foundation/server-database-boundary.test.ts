import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("server database boundary", () => {
  it("keeps the Next server-only marker outside the CLI-compatible database client", () => {
    expect(source("src/server/db/index.ts")).toContain('import "server-only";');
    expect(source("src/server/db/client.ts")).not.toContain(
      'import "server-only";',
    );
    expect(source("src/app/api/health/route.ts")).toContain(
      'from "@/server/db";',
    );
  });
});
