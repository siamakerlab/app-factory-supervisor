import { describe, expect, it } from "vitest";

import { assertNoSecrets, redactSecrets, scanForSecrets, SecretLeakError } from "./secretScanner.js";

describe("secretScanner", () => {
  it("detects common key, token, and signing secret leaks", () => {
    const findings = scanForSecrets(
      [
        "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456",
        "storePassword=verysecretpassword",
        "-----BEGIN PRIVATE KEY-----"
      ].join("\n")
    );

    expect(findings.map((finding) => finding.kind)).toContain("openai_api_key");
    expect(findings.map((finding) => finding.kind)).toContain("password_assignment");
    expect(findings.map((finding) => finding.kind)).toContain("private_key");
  });

  it("redacts secret-looking values before log persistence", () => {
    const result = redactSecrets("keyPassword=secretpassword123");

    expect(result.findings).toHaveLength(1);
    expect(result.redacted).toBe("[REDACTED_SECRET]");
  });

  it("throws a structured error for rejected prompt/email text", () => {
    expect(() => assertNoSecrets("secret=supersecretvalue")).toThrow(SecretLeakError);
  });
});
