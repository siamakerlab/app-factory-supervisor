import { describe, expect, it } from "vitest";

import { createProjectSchema } from "./schema.js";

describe("createProjectSchema", () => {
  it("accepts the required new-project wizard fields", () => {
    const result = createProjectSchema.parse({
      projectName: "Budget Planner",
      appName: "Budget Planner",
      packageName: "kr.example.budgetplanner",
      userAppPlan: "A simple Android budget planning app for households.",
      projectType: "new",
      repositoryUrl: "ssh://git@example.com:2222/wody/budget-planner.git",
      globalGitUserName: "Wody",
      globalGitUserEmail: "wody@example.com",
      maxExecutionHours: 24,
      maxWorkerTurns: 200
    });

    expect(result.projectType).toBe("new");
    expect(result.packageName).toBe("kr.example.budgetplanner");
  });

  it("rejects invalid Android package names", () => {
    const result = createProjectSchema.safeParse({
      projectName: "Bad Package",
      appName: "Bad Package",
      packageName: "Bad.Package",
      userAppPlan: "A simple Android app with an invalid package name.",
      projectType: "existing",
      repositoryUrl: "git@example.com:wody/bad.git",
      globalGitUserName: "Wody",
      globalGitUserEmail: "wody@example.com"
    });

    expect(result.success).toBe(false);
  });
});
