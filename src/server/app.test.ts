import { describe, expect, it } from "vitest";

import { buildServer } from "./app.js";

describe("server health", () => {
  it("returns starting before migrations are ready", async () => {
    const server = await buildServer({
      migrated: false
    });
    const response = await server.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: "starting",
      service: "app-factory-supervisor",
      checks: {
        migrations: "pending"
      }
    });
  });

  it("returns ready after migrations are complete", async () => {
    const server = await buildServer({
      migrated: true
    });
    const response = await server.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ready",
      service: "app-factory-supervisor",
      checks: {
        migrations: "pass"
      }
    });
  });
});
