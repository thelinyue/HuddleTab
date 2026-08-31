import { readFile } from "node:fs/promises";

import { expect, it } from "vitest";

it("V1 migration 基线包含业务约束和两个单例初始化，不包含备份维护对象", async () => {
  const migration = await readFile("drizzle/0000_v1_baseline.sql", "utf8");

  expect(migration).toContain('CONSTRAINT "activity_members_type_ck"');
  expect(migration).toContain('CONSTRAINT "activities_owner_same_activity_fk"');
  expect(migration).toContain(
    'CREATE UNIQUE INDEX "activity_members_one_owner_uq"',
  );
  expect(migration).toContain(
    'CONSTRAINT "settlements_payer_same_activity_fk"',
  );
  expect(migration).toContain(
    'CONSTRAINT "settlements_receiver_same_activity_fk"',
  );
  expect(migration).toContain(
    'CONSTRAINT "settlements_creator_same_activity_fk"',
  );
  expect(migration).toContain(
    'CONSTRAINT "settlements_deleted_by_same_activity_fk"',
  );
  expect(migration).toContain(
    'INSERT INTO "system_settings" ("id") VALUES (\'singleton\')',
  );
  expect(migration).toContain(
    'INSERT INTO "system_bootstrap" ("id") VALUES (\'singleton\')',
  );
  expect(migration).not.toMatch(/backup|maintenance/i);
});
