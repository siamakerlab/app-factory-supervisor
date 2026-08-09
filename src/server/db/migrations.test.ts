import { describe, expect, it } from "vitest";

import { expectedMvpIndexes, expectedMvpTables, migrations } from "./migrations.js";

describe("MVP schema migration", () => {
  it("contains the full MVP table set", () => {
    const sql = migrations.map((migration) => migration.sql).join("\n");

    for (const table of expectedMvpTables) {
      expect(sql).toContain(`create table if not exists ${table}`);
    }
  });

  it("contains the required MVP indexes", () => {
    const sql = migrations.map((migration) => migration.sql).join("\n");

    for (const index of expectedMvpIndexes) {
      expect(sql).toContain(`create index if not exists ${index}`);
    }
  });

  it("seeds singleton app settings", () => {
    expect(migrations[0]?.sql).toContain("insert into app_settings");
    expect(migrations[0]?.sql).toContain("on conflict (id) do nothing");
  });
});
