import type { ProjectDetail, UserRequiredItemSummary } from "../projects/service.js";

export type CompletionGateInput = {
  project: ProjectDetail;
  runCounts: {
    workerTurns: number;
    failedRuns: number;
  };
  jobCounts: {
    failedJobs: number;
    staleJobs: number;
  };
  now: Date;
};

export type CompletionGateResult = {
  status:
    | "running"
    | "production_ready_user_action_required"
    | "blocked_needs_user"
    | "budget_exhausted"
    | "failed"
    | "cancelled";
  productionReady: boolean;
  evidence: string[];
  remainingUserActions: Array<{
    key: string;
    label: string;
    status: string;
  }>;
  blockers: string[];
  summary: string;
};

const externalActionKeys = new Set([
  "api_keys",
  "oauth_setup",
  "admob_ids",
  "play_console_service_account",
  "production_signing_key",
  "dns_domain",
  "legal_policy_approval",
  "privacy_policy_url"
]);

export function evaluateCompletionGate(input: CompletionGateInput): CompletionGateResult {
  const evidence: string[] = [];
  const blockers: string[] = [];
  const remainingUserActions = userActions(input.project.userRequiredItems);
  const nonExternalGates = input.project.progress.gates.filter(
    (gate) => gate.key !== "external_user_actions"
  );
  const failedGates = input.project.progress.gates.filter((gate) => gate.status === "fail");
  const incompleteNonExternalGates = nonExternalGates.filter(
    (gate) => gate.status !== "pass" && gate.status !== "skipped"
  );

  if (input.project.status === "cancelled") {
    return finish("cancelled", false, evidence, remainingUserActions, blockers, "Project was cancelled.");
  }
  if (input.runCounts.workerTurns >= input.project.maxWorkerTurns) {
    blockers.push(`Worker turn budget exhausted: ${input.runCounts.workerTurns}/${input.project.maxWorkerTurns}.`);
    return finish("budget_exhausted", false, evidence, remainingUserActions, blockers);
  }
  if (new Date(input.project.createdAt).getTime() + input.project.maxExecutionHours * 3600_000 <= input.now.getTime()) {
    blockers.push(`Execution time budget exhausted: ${input.project.maxExecutionHours} hours.`);
    return finish("budget_exhausted", false, evidence, remainingUserActions, blockers);
  }
  if (input.runCounts.failedRuns > 0 || input.jobCounts.failedJobs > 0) {
    blockers.push(`Failed runs/jobs exist: ${input.runCounts.failedRuns} runs, ${input.jobCounts.failedJobs} jobs.`);
    return finish("failed", false, evidence, remainingUserActions, blockers);
  }
  if (input.jobCounts.staleJobs > 0) {
    blockers.push(`Stale jobs exist: ${input.jobCounts.staleJobs}.`);
    return finish("failed", false, evidence, remainingUserActions, blockers);
  }
  if (failedGates.length > 0) {
    blockers.push(`Failed progress gates: ${failedGates.map((gate) => gate.label).join(", ")}.`);
    return finish("failed", false, evidence, remainingUserActions, blockers);
  }
  if (input.project.verification.overallStatus === "fail" || input.project.verification.overallStatus === "mixed") {
    blockers.push("Verification results include failing evidence.");
    return finish("failed", false, evidence, remainingUserActions, blockers);
  }

  evidence.push(`${input.project.progress.completedGates}/${input.project.progress.totalGates} progress gates complete.`);
  evidence.push(`Latest verification tier: ${input.project.verification.latestTier ?? "none"}.`);
  evidence.push(`${input.project.recentArtifacts.length} recent artifacts available.`);

  const hardUserBlockers = input.project.userRequiredItems.filter(
    (item) =>
      !externalActionKeys.has(item.key) &&
      item.requiredForProduction &&
      !item.canContinueWithoutIt &&
      ["needed", "failed", "blocked"].includes(item.status)
  );
  if (hardUserBlockers.length > 0 && incompleteNonExternalGates.length > 0) {
    blockers.push(`Required user clarification is blocking automation: ${hardUserBlockers.map((item) => item.label).join(", ")}.`);
    return finish("blocked_needs_user", false, evidence, remainingUserActions, blockers);
  }

  if (incompleteNonExternalGates.length === 0) {
    evidence.push("All non-external production gates are pass/skipped.");
    return finish(
      "production_ready_user_action_required",
      true,
      evidence,
      remainingUserActions,
      blockers,
      remainingUserActions.length > 0
        ? `Production-level implementation is ready; ${remainingUserActions.length} user-owned action(s) remain.`
        : "Production-level implementation is ready; no user-owned action is currently recorded."
    );
  }

  blockers.push(`${incompleteNonExternalGates.length} non-external progress gate(s) remain.`);
  return finish("running", false, evidence, remainingUserActions, blockers);
}

function userActions(items: UserRequiredItemSummary[]) {
  return items
    .filter((item) => externalActionKeys.has(item.key) && ["needed", "failed", "blocked"].includes(item.status))
    .map((item) => ({
      key: item.key,
      label: item.label,
      status: item.status
    }));
}

function finish(
  status: CompletionGateResult["status"],
  productionReady: boolean,
  evidence: string[],
  remainingUserActions: CompletionGateResult["remainingUserActions"],
  blockers: string[],
  summary?: string
): CompletionGateResult {
  return {
    status,
    productionReady,
    evidence,
    remainingUserActions,
    blockers,
    summary:
      summary ??
      (blockers.length > 0
        ? blockers[0]!
        : productionReady
          ? "Production-level implementation is ready."
          : "Project is still running.")
  };
}
