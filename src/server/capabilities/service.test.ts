import { describe, expect, it } from "vitest";

import { defaultCapabilities } from "./service.js";

describe("default capability inventory", () => {
  it("excludes App Factory Autopilot and Sequential Thinking defaults", () => {
    const ids = defaultCapabilities.map((capability) => capability.id);

    expect(ids.some((id) => id.includes("app-factory"))).toBe(false);
    expect(ids.some((id) => id.includes("sequential"))).toBe(false);
  });

  it("separates wizard-installed MCPs from bundled worker skills and agents", () => {
    const requiredMcps = defaultCapabilities.filter(
      (capability) => capability.type === "mcp" && capability.required
    );
    const bundledSkills = defaultCapabilities.filter(
      (capability) => capability.type === "skill" && capability.sourceType === "bundled"
    );
    const bundledAgents = defaultCapabilities.filter(
      (capability) => capability.type === "agent" && capability.sourceType === "bundled"
    );

    expect(requiredMcps.map((capability) => capability.id)).toEqual([
      "mobile-docs",
      "context7",
      "mobile-mcp",
      "playwright",
      "memory",
      "time"
    ]);
    expect(requiredMcps.every((capability) => capability.installStage === "wizard")).toBe(true);
    expect(bundledSkills.length).toBeGreaterThan(20);
    expect(bundledAgents.length).toBeGreaterThan(10);
    expect([...bundledSkills, ...bundledAgents].every((capability) => capability.wiredTo.includes("worker"))).toBe(
      true
    );
  });
});
