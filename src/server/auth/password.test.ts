import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password.js";
import { createSessionToken, hashSessionToken } from "./tokens.js";

describe("auth crypto helpers", () => {
  it("hashes and verifies passwords without storing plaintext", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(hash).not.toContain("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
  });

  it("hashes session tokens one way", () => {
    const token = createSessionToken();
    const tokenHash = hashSessionToken(token);

    expect(token).not.toEqual(tokenHash);
    expect(tokenHash).toHaveLength(64);
    expect(hashSessionToken(token)).toEqual(tokenHash);
  });
});
