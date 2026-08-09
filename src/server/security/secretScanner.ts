export type SecretScanFinding = {
  kind: string;
  index: number;
};

const secretPatterns: Array<{ kind: string; pattern: RegExp }> = [
  { kind: "private_key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { kind: "openai_api_key", pattern: /sk-[A-Za-z0-9_-]{20,}/g },
  { kind: "google_api_key", pattern: /AIza[0-9A-Za-z_-]{20,}/g },
  { kind: "github_token", pattern: /gh[pousr]_[A-Za-z0-9_]{20,}/g },
  { kind: "password_assignment", pattern: /\b(storepass|keypass|storePassword|keyPassword|password|secret)\s*[:=]\s*['"]?[^'"\s]{8,}/gi },
  { kind: "signing_properties", pattern: /\b(keyAlias|storeFile)\s*=/g }
];

export function scanForSecrets(text: string): SecretScanFinding[] {
  const findings: SecretScanFinding[] = [];
  for (const { kind, pattern } of secretPatterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      findings.push({
        kind,
        index: match.index ?? 0
      });
    }
  }
  return findings.sort((left, right) => left.index - right.index);
}

export function assertNoSecrets(text: string): void {
  const findings = scanForSecrets(text);
  if (findings.length > 0) {
    throw new SecretLeakError(findings);
  }
}

export function redactSecrets(text: string): {
  redacted: string;
  findings: SecretScanFinding[];
} {
  let redacted = text;
  const findings = scanForSecrets(text);
  for (const { pattern } of secretPatterns) {
    redacted = redacted.replace(pattern, "[REDACTED_SECRET]");
  }
  return {
    redacted,
    findings
  };
}

export class SecretLeakError extends Error {
  constructor(readonly findings: SecretScanFinding[]) {
    super("secret_leak_detected");
  }
}
