import type { ProgressGateSummary, ProjectDetail } from "../projects/service.js";
import { defaultVerificationTierForPhase, type VerificationTier } from "./verificationTiers.js";

export type LifecyclePromptArea =
  | "product_definition"
  | "market_review"
  | "roadmap"
  | "ux_planning"
  | "implementation"
  | "gap_review"
  | "qa_scenario"
  | "emulator"
  | "code_review"
  | "final_readiness";

export type LifecyclePromptTemplate = {
  area: LifecyclePromptArea;
  taskType:
    | "product_planning"
    | "market_research"
    | "roadmap_creation_audit"
    | "ux_planning"
    | "implementation"
    | "code_review"
    | "verification"
    | "bug_fixing"
    | "screenshot_analysis"
    | "release_readiness_summary";
  verificationTier: VerificationTier;
  build: (input: { project: ProjectDetail; gate?: ProgressGateSummary }) => string;
};

export const lifecyclePromptTemplates: Record<LifecyclePromptArea, LifecyclePromptTemplate> = {
  product_definition: {
    area: "product_definition",
    taskType: "product_planning",
    verificationTier: "T0",
    build: ({ project }) =>
      [
        `Clarify product definition for ${project.appName}.`,
        "Cover core purpose, expected user value, minimum usable product, required/optional features, assumptions, and open questions.",
        "Update or create MVP notes only if needed.",
        "Acceptance: concise summary, changed files/artifacts, blockers, and A-G next options."
      ].join(" ")
  },
  market_review: {
    area: "market_review",
    taskType: "market_research",
    verificationTier: "T1",
    build: ({ project }) =>
      [
        `Perform market review for ${project.appName}.`,
        "Use web search, Play Store search, communities/forums/reviews.",
        "Find at least 5 Play Store competitors and 3 community sources when available.",
        "Record URL/query/region/language/date/title/summary; separate evidence from inference.",
        "Acceptance: market research artifact, deferred insights, blockers, and A-G next options."
      ].join(" ")
  },
  roadmap: {
    area: "roadmap",
    taskType: "roadmap_creation_audit",
    verificationTier: "T1",
    build: ({ project }) =>
      [
        `Create or audit roadmap for ${project.appName}.`,
        "Check order, contradictions, realism, dependencies, risks, scope creep, cost vs value, competitor feature coverage, and deferred rationale.",
        "Acceptance: roadmap updates or audit artifact, explicit deferred items, blockers, and A-G next options."
      ].join(" ")
  },
  ux_planning: {
    area: "ux_planning",
    taskType: "ux_planning",
    verificationTier: "T1",
    build: ({ project }) =>
      [
        `Plan UX for ${project.appName}.`,
        "Cover domain-appropriate UI, main flows, empty/loading/error/retry/success states, navigation/back/gestures, accessibility basics.",
        "Include phone, foldable, tablet, landscape, and large-screen behavior.",
        "Acceptance: UX plan artifact, layout risks, blockers, and A-G next options."
      ].join(" ")
  },
  implementation: {
    area: "implementation",
    taskType: "implementation",
    verificationTier: "T2",
    build: ({ gate }) =>
      [
        `Implement one scoped roadmap item: ${gate?.label ?? "next implementation task"}.`,
        "Touch only necessary files/areas and keep the task coherent.",
        "Confirm keystores, signing properties, passwords, and secrets stay ignored before any commit.",
        "Acceptance: changed files, build/test or targeted verification, blockers, and A-G next options."
      ].join(" ")
  },
  gap_review: {
    area: "gap_review",
    taskType: "verification",
    verificationTier: "T2",
    build: ({ project }) =>
      [
        `Run gap review for ${project.appName}.`,
        "Compare MVP vs roadmap, roadmap vs implemented code, implemented code vs user behavior, planned UX vs screens, deferred vs production requirements.",
        "Do not run emulator/device verification.",
        "Acceptance: gap report, fixes if small and safe, blockers, and A-G next options."
      ].join(" ")
  },
  qa_scenario: {
    area: "qa_scenario",
    taskType: "verification",
    verificationTier: "T2",
    build: ({ project }) =>
      [
        `Create QA scenario plan for ${project.appName}.`,
        "Cover core features, screens, buttons, gestures, navigation/back, states, permission flows, data entry/validation, orientation/window size.",
        "Include phone/foldable/tablet scenarios without launching emulator.",
        "Acceptance: scenario artifact, required test data, blockers, and A-G next options."
      ].join(" ")
  },
  emulator: {
    area: "emulator",
    taskType: "screenshot_analysis",
    verificationTier: "T4",
    build: ({ project }) =>
      [
        `Run emulator/device verification for ${project.appName}.`,
        "Use phone, foldable, and tablet targets as appropriate.",
        "Collect screenshots, logs, and test output; analyze UI, insets, crashes, and scenario failures.",
        "Acceptance: evidence artifacts, fixes or bug list, blockers, and A-G next options."
      ].join(" ")
  },
  code_review: {
    area: "code_review",
    taskType: "code_review",
    verificationTier: "T2",
    build: ({ project }) =>
      [
        `Review code for ${project.appName}.`,
        "Cover architecture, data layer, state management, coroutine/Flow, errors, permissions/privacy, secrets, performance, release packaging, R8/ProGuard, dependencies, policy, and LGPL compliance.",
        "Confirm project .gitignore protects keystores, signing properties, passwords, and secret files.",
        "Acceptance: findings with files, fixes if scoped, verification, blockers, and A-G next options."
      ].join(" ")
  },
  final_readiness: {
    area: "final_readiness",
    taskType: "release_readiness_summary",
    verificationTier: "T3",
    build: ({ project }) =>
      [
        `Prepare final readiness summary for ${project.appName}.`,
        "Summarize worker evidence, remaining user-owned external actions, store assets/policy/API/ad IDs/signing gaps, and production-readiness decision.",
        "Acceptance: final status, evidence links, user action checklist, and A-G next options if not ready."
      ].join(" ")
  }
};

export function lifecycleAreaForGate(gate: ProgressGateSummary | undefined): LifecyclePromptArea {
  if (!gate) {
    return "final_readiness";
  }
  if (["requirements_clarified", "mvp_drafted", "mvp_revised"].includes(gate.key)) {
    return "product_definition";
  }
  if (gate.key === "market_review_completed") {
    return "market_review";
  }
  if (["roadmap_drafted", "roadmap_audit_passes", "deferred_items"].includes(gate.key)) {
    return "roadmap";
  }
  if (["frontend_ux_plan", "phone_foldable_tablet_plan", "ui_states"].includes(gate.key)) {
    return "ux_planning";
  }
  if (["roadmap_code_gap_review"].includes(gate.key)) {
    return "gap_review";
  }
  if (["android_build", "tests", "qa_scenario_plan"].includes(gate.key)) {
    return "qa_scenario";
  }
  if (
    ["emulator_device_tests", "screenshot_review", "device_matrix_verification"].includes(gate.key)
  ) {
    return "emulator";
  }
  if (
    [
      "full_code_review",
      "placeholders_cleared",
      "permissions_privacy",
      "signing_release_packaging",
      "docs_runbook"
    ].includes(gate.key)
  ) {
    return "code_review";
  }
  if (gate.key === "external_user_actions") {
    return "final_readiness";
  }
  return "implementation";
}

export function buildLifecyclePrompt(input: {
  project: ProjectDetail;
  gate?: ProgressGateSummary;
}): {
  area: LifecyclePromptArea;
  taskType: LifecyclePromptTemplate["taskType"];
  verificationTier: LifecyclePromptTemplate["verificationTier"];
  prompt: string;
} {
  const area = lifecycleAreaForGate(input.gate);
  const template = lifecyclePromptTemplates[area];
  const verificationTier = input.gate
    ? defaultVerificationTierForPhase(input.gate.phase, input.gate.key)
    : template.verificationTier;
  return {
    area,
    taskType: template.taskType,
    verificationTier,
    prompt: template.build(input)
  };
}
