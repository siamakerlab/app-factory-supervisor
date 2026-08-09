import { describe, expect, it, vi } from "vitest";

import { buildServer } from "../app.js";
import type { JobService } from "../jobs/service.js";
import { registerProjectRoutes } from "./routes.js";
import type { ProjectDetail, ProjectService } from "./service.js";

const projectId = "11111111-1111-4111-8111-111111111111";

describe("project run routes", () => {
  it("enqueues a supervisor turn and returns the next worker prompt when starting a run", async () => {
    const server = await buildServer({
      readiness: {
        migrated: true
      }
    });
    const enqueue = vi.fn().mockResolvedValue({
      id: "job-1",
      projectId,
      jobType: "supervisor_turn",
      status: "queued"
    });
    registerProjectRoutes(
      server,
      {
        getProjectDetail: vi.fn().mockResolvedValue(projectDetail()),
        startProjectRun: vi.fn().mockResolvedValue(projectDetail({ status: "running" }))
      } as Partial<ProjectService> as ProjectService,
      {} as never,
      undefined,
      {
        enqueue
      } as Partial<JobService> as JobService
    );

    const response = await server.inject({
      method: "POST",
      url: `/api/projects/${projectId}/run/start`
    });

    expect(response.statusCode).toBe(201);
    expect(enqueue).toHaveBeenCalledWith({
      projectId,
      jobType: "supervisor_turn",
      priority: 10
    });
    expect(response.json()).toMatchObject({
      projectId,
      nextPrompt: {
        projectId,
        source: "progress_gate"
      },
      project: {
        id: projectId,
        status: "running"
      }
    });
  });

  it("returns the stopped project detail when stopping a run", async () => {
    const stoppedProject = projectDetail({
      status: "cancelled",
      finalStatusSummary: "Run cancelled by user."
    });
    const server = await buildServer({
      readiness: {
        migrated: true
      }
    });
    registerProjectRoutes(
      server,
      {
        stopProjectRun: vi.fn().mockResolvedValue(stoppedProject)
      } as Partial<ProjectService> as ProjectService,
      {} as never
    );

    const response = await server.inject({
      method: "POST",
      url: `/api/projects/${projectId}/run/stop`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: projectId,
      status: "cancelled",
      finalStatusSummary: "Run cancelled by user."
    });
  });
});

function projectDetail(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: projectId,
    projectName: "Demo Project",
    appName: "Demo App",
    packageName: "kr.example.demo",
    projectType: "new",
    repositoryUrl: "ssh://git@example.com/demo.git",
    projectDir: "/tmp/demo",
    status: "running",
    currentPhase: "product definition",
    maxExecutionHours: 24,
    maxWorkerTurns: 200,
    remoteReachable: true,
    currentVersion: "0.1.0+260809001",
    lastCommitSha: null,
    lastPushedCommitSha: null,
    latestWorkerResponse: null,
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    progress: {
      totalGates: 1,
      completedGates: 0,
      percent: 0,
      gates: [
        {
          key: "mvp_written",
          label: "MVP written",
          phase: "product definition",
          status: "pending",
          weight: 1,
          evidenceArtifactId: null,
          updatedAt: "2026-08-09T00:00:00.000Z"
        }
      ]
    },
    timeline: [],
    currentSupervisorPrompt: null,
    verification: {
      overallStatus: "unknown",
      latestTier: null,
      recent: []
    },
    userRequiredItems: [],
    supervisorInstructions: [],
    recentArtifacts: [],
    recentExports: [],
    finalStatusSummary: "Automation is running.",
    ...overrides
  };
}
