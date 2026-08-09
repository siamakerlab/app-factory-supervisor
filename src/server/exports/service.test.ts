import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { assertInsideRoot } from "./service.js";

describe("project export path filtering", () => {
  it("allows files inside the configured root", () => {
    expect(() =>
      assertInsideRoot(
        join("/tmp/app-factory", "data", "artifacts", "export.zip"),
        join("/tmp/app-factory", "data"),
        "outside"
      )
    ).not.toThrow();
  });

  it("rejects traversal outside the configured root", () => {
    expect(() =>
      assertInsideRoot(
        join("/tmp/app-factory", "projects", "..", "data-secret", "export.zip"),
        join("/tmp/app-factory", "projects"),
        "outside"
      )
    ).toThrow("outside");
  });
});
