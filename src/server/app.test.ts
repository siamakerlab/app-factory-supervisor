import { describe, expect, it } from "vitest";

import { buildServer } from "./app.js";

describe("server health", () => {
  it("returns the health payload", async () => {
    const server = await buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "app-factory-supervisor"
    });
  });
});
