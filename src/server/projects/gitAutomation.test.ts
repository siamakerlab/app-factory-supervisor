import { describe, expect, it } from "vitest";

import { formatCommitMessage } from "./gitAutomation.js";

describe("formatCommitMessage", () => {
  it("includes unit type, scope, version, and verification tier", () => {
    expect(
      formatCommitMessage(
        {
          unitType: "feat",
          scope: "project wizard",
          verificationTier: "T2"
        },
        "0.1.1+260809001"
      )
    ).toBe("feat: project wizard 0.1.1+260809001 T2");
  });

  it("defaults to T0 when verification tier is not supplied", () => {
    expect(
      formatCommitMessage(
        {
          unitType: "docs",
          scope: "roadmap note"
        },
        "0.1.2+260809001"
      )
    ).toBe("docs: roadmap note 0.1.2+260809001 T0");
  });
});
