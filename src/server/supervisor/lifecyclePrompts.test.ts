import { describe, expect, it } from "vitest";

import type { ProjectDetail, ProgressGateSummary } from "../projects/service.js";
import {
  buildLifecyclePrompt,
  lifecycleAreaForGate,
  lifecyclePromptTemplates
} from "./lifecyclePrompts.js";

const requiredAreas = [
  "product_definition",
  "market_review",
  "roadmap",
  "ux_planning",
  "implementation",
  "gap_review",
  "qa_scenario",
  "emulator",
  "code_review",
  "final_readiness"
] as const;

describe("lifecyclePromptTemplates", () => {
  it("covers every lifecycle area with short scoped worker prompts", () => {
    for (const area of requiredAreas) {
      const template = lifecyclePromptTemplates[area];
      const prompt = template.build({ project: project(), gate: gate("core_features", "Core features") });

      expect(template.area).toBe(area);
      expect(prompt.split(/\s+/).length).toBeLessThanOrEqual(300);
      expect(prompt).toContain("Acceptance:");
    }
  });

  it("maps MVP gates to lifecycle prompt areas", () => {
    expect(lifecycleAreaForGate(gate("market_review_completed", "Market"))).toBe("market_review");
    expect(lifecycleAreaForGate(gate("frontend_ux_plan", "UX"))).toBe("ux_planning");
    expect(lifecycleAreaForGate(gate("emulator_device_tests", "Emulator"))).toBe("emulator");
    expect(lifecycleAreaForGate(gate("full_code_review", "Review"))).toBe("code_review");
    expect(lifecycleAreaForGate(undefined)).toBe("final_readiness");
  });

  it("builds area metadata with each prompt", () => {
    const built = buildLifecyclePrompt({
      project: project(),
      gate: gate("roadmap_drafted", "Roadmap drafted")
    });

    expect(built.area).toBe("roadmap");
    expect(built.taskType).toBe("roadmap_creation_audit");
    expect(built.verificationTier).toBe("T1");
  });
});

function gate(key: string, label: string): ProgressGateSummary {
  return {
    key,
    label,
    phase: "implementation",
    status: "pending",
    weight: 1,
    evidenceArtifactId: null,
    updatedAt: new Date(0).toISOString()
  };
}

function project(): ProjectDetail {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    projectName: "Demo",
    appName: "Demo",
    packageName: "com.example.demo",
    projectType: "new",
    repositoryUrl: "ssh://example/demo.git",
    projectDir: "/tmp/demo",
    status: "running",
    currentPhase: "implementation",
    maxExecutionHours: 24,
    maxWorkerTurns: 200,
    remoteReachable: true,
    currentVersion: "0.1.0",
    lastCommitSha: null,
    lastPushedCommitSha: null,
    latestWorkerResponse: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    progress: { totalGates: 0, completedGates: 0, percent: 0, gates: [] },
    timeline: [],
    currentSupervisorPrompt: null,
    verification: { overallStatus: "unknown", recent: [] },
    userRequiredItems: [],
    supervisorInstructions: [],
    recentArtifacts: [],
    recentExports: [],
    finalStatusSummary: "Running."
  };
}
