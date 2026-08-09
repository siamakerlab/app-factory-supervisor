export type VerificationTier = "T0" | "T1" | "T2" | "T3" | "T4";

export type VerificationTierPolicy = {
  tier: VerificationTier;
  label: string;
  rationale: string;
  emulatorAllowed: boolean;
};

const emulatorBlockedPhases = new Set([
  "product definition",
  "market review",
  "roadmap planning",
  "UX planning",
  "implementation",
  "gap review"
]);

export const verificationTierPolicies: Record<VerificationTier, VerificationTierPolicy> = {
  T0: {
    tier: "T0",
    label: "metadata check",
    rationale: "Use for cheap state, artifact, schema, and prompt-contract checks.",
    emulatorAllowed: false
  },
  T1: {
    tier: "T1",
    label: "targeted static check",
    rationale: "Use for focused static checks, docs checks, and narrow parser/planner validation.",
    emulatorAllowed: false
  },
  T2: {
    tier: "T2",
    label: "module build/test",
    rationale: "Use for feature completion and most non-QA implementation evidence.",
    emulatorAllowed: false
  },
  T3: {
    tier: "T3",
    label: "full non-emulator verification",
    rationale: "Use before terminal readiness for full build/test without device scenarios.",
    emulatorAllowed: false
  },
  T4: {
    tier: "T4",
    label: "emulator and release readiness verification",
    rationale: "Use only in QA/emulator or terminal readiness phases because it is expensive.",
    emulatorAllowed: true
  }
};

export function defaultVerificationTierForPhase(phase: string, gateKey?: string): VerificationTier {
  if (
    gateKey &&
    ["emulator_device_tests", "screenshot_review", "device_matrix_verification"].includes(gateKey)
  ) {
    return "T4";
  }
  if (
    gateKey &&
    [
      "requirements_clarified",
      "mvp_drafted",
      "market_review_completed",
      "mvp_revised",
      "roadmap_drafted",
      "roadmap_audit_passes",
      "deferred_items",
      "frontend_ux_plan",
      "phone_foldable_tablet_plan"
    ].includes(gateKey)
  ) {
    return "T1";
  }
  if (phase === "production ready") {
    return "T4";
  }
  if (phase === "code review") {
    return "T3";
  }
  if (["implementation", "gap review", "QA planning"].includes(phase)) {
    return "T2";
  }
  return "T1";
}

export function canScheduleEmulatorVerification(input: {
  phase: string;
  gateKey?: string;
  explicitUserRequest?: boolean;
}): boolean {
  if (input.explicitUserRequest) {
    return true;
  }
  if (
    input.gateKey &&
    ["emulator_device_tests", "screenshot_review", "device_matrix_verification"].includes(input.gateKey)
  ) {
    return true;
  }
  return !emulatorBlockedPhases.has(input.phase);
}
