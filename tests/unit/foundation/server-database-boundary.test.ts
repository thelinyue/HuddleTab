import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tsxEntrypoint = resolve("node_modules/tsx/dist/cli.mjs");
const databaseRuntimeEntrypoint = resolve("src/server/db/client.ts");

describe("server database boundary", () => {
  it("rejects a direct Node import of the database runtime entrypoint", async () => {
    await expect(
      execFileAsync(
        process.execPath,
        [tsxEntrypoint, databaseRuntimeEntrypoint],
        {
          env: { ...process.env },
        },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Client Component"),
    });
  });
});
