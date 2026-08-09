import { describe, expect, it } from "vitest";

import { parseCodexDeviceLoginOutput } from "./auth.js";

describe("Codex device login parsing", () => {
  it("extracts the verification URL and device code from Codex CLI output", () => {
    const parsed = parseCodexDeviceLoginOutput(`
Follow these steps to sign in with ChatGPT using device code authorization:

1. Open this link in your browser and sign in to your account
   https://auth.openai.com/codex/device

2. Enter this one-time code (expires in 15 minutes)
   I61P-VBVJR
`);

    expect(parsed.verificationUri).toBe("https://auth.openai.com/codex/device");
    expect(parsed.userCode).toBe("I61P-VBVJR");
    expect(parsed.expiresAt).toBeTruthy();
  });
});
