import { describe, expect, it } from "vitest";

import { agentsGuidanceWorkerPrompt, buildAgentsMd } from "./service.js";

describe("project AGENTS.md guidance", () => {
  it("builds Android/Kotlin worker guidance with required boundaries", () => {
    const text = buildAgentsMd({
      appName: "Budget Planner",
      packageName: "kr.example.budget"
    });

    expect(text).toContain("Android/Kotlin only");
    expect(text).toContain("supervisor only selects");
    expect(text).toContain("keystores/");
    expect(text).toContain("T0 metadata");
    expect(text).toContain("English commit message");
  });

  it("uses a scoped worker prompt for existing project AGENTS.md updates", () => {
    const prompt = agentsGuidanceWorkerPrompt({
      appName: "Budget Planner",
      packageName: "kr.example.budget"
    });

    expect(prompt).toContain("Create or update AGENTS.md");
    expect(prompt).toContain("Do not include secrets");
    expect(prompt.split(/\s+/).length).toBeLessThan(120);
  });
});
