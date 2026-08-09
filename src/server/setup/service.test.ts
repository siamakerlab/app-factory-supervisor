import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { AppConfig } from "../config.js";
import { SetupService } from "./service.js";

describe("setup wizard service", () => {
  it("does not expose SSH private key content in status", async () => {
    const dir = await mkdtemp(join(tmpdir(), "afs-setup-"));
    const queries: string[] = [];
    const service = new SetupService(
      {
        pool: {
          query: (sql: string) => {
            queries.push(sql);
            if (sql.includes("select 1 from users")) {
              return Promise.resolve({ rows: [{ "?column?": 1 }], rowCount: 1 });
            }
            if (sql.includes("select * from setup_wizard_state")) {
              return Promise.resolve({
                rows: [
                  {
                    admin_step_status: "pass",
                    environment_step_status: "pending",
                    ssh_step_status: "pending",
                    setup_complete: false,
                    os_name: null,
                    cpu_arch: null,
                    install_paths: {},
                    command_checks: [],
                    ssh_public_key_path: null,
                    last_error: null
                  }
                ],
                rowCount: 1
              });
            }
            return Promise.resolve({ rows: [], rowCount: 1 });
          }
        },
        close: () => Promise.resolve(),
        ping: () => Promise.resolve()
      } as never,
      {
        APP_DATA_DIR: dir,
        APP_PROJECTS_DIR: join(dir, "projects")
      } as AppConfig
    );

    const status = await service.getStatus();

    expect(status.sshPublicKey).toBeNull();
    expect(JSON.stringify(status)).not.toContain("PRIVATE KEY");
    expect(queries.length).toBeGreaterThan(0);

    await rm(dir, {
      recursive: true,
      force: true
    });
  });
});
