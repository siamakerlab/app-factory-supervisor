import { describe, expect, it } from "vitest";

import {
  canScheduleEmulatorVerification,
  defaultVerificationTierForPhase,
  verificationTierPolicies
} from "./verificationTiers.js";

describe("verification tier policy", () => {
  it("defines T0 through T4 with rationale", () => {
    expect(Object.keys(verificationTierPolicies)).toEqual(["T0", "T1", "T2", "T3", "T4"]);
    expect(verificationTierPolicies.T0.rationale).toContain("cheap");
    expect(verificationTierPolicies.T4.emulatorAllowed).toBe(true);
  });

  it("blocks emulator verification outside QA/emulator phases unless user explicitly asks", () => {
    expect(canScheduleEmulatorVerification({ phase: "roadmap planning" })).toBe(false);
    expect(canScheduleEmulatorVerification({ phase: "implementation" })).toBe(false);
    expect(canScheduleEmulatorVerification({ phase: "gap review" })).toBe(false);
    expect(
      canScheduleEmulatorVerification({
        phase: "emulator verification",
        gateKey: "emulator_device_tests"
      })
    ).toBe(true);
    expect(
      canScheduleEmulatorVerification({
        phase: "implementation",
        explicitUserRequest: true
      })
    ).toBe(true);
  });

  it("chooses cheap defaults before implementation and T4 only for terminal/emulator gates", () => {
    expect(defaultVerificationTierForPhase("roadmap planning", "roadmap_drafted")).toBe("T1");
    expect(defaultVerificationTierForPhase("implementation", "core_features")).toBe("T2");
    expect(defaultVerificationTierForPhase("code review", "full_code_review")).toBe("T3");
    expect(defaultVerificationTierForPhase("emulator verification", "screenshot_review")).toBe("T4");
  });
});
