# Administrator Guide

## Fail2ban Host Setup

The app writes auth failures to `AUTH_LOG_PATH` in this format:

```text
AUTH_FAIL ip=<ip> admin_id=<id> reason=<reason>
```

Copy `deploy/fail2ban/app-factory-supervisor-filter.conf` to the host fail2ban filter directory and
`deploy/fail2ban/app-factory-supervisor-jail.conf` to the jail directory. Mount or forward
`/app/data/logs/auth.log` to the host path configured as `logpath`. The default jail bans after three
failures.

## Trusted Proxy

Set `TRUST_PROXY=true` only when the app is behind a trusted reverse proxy that provides correct
client IP and protocol headers. If TLS terminates at the proxy, also set `SESSION_COOKIE_SECURE=true`
and expose the app only through HTTPS.

## Codex Auth

Codex authentication is app-managed under `/app/data/codex-home` by default. Keep this location out
of project workspaces. Treat Codex auth files as credentials and avoid mounting them writable into
other containers.

## Generated App-Server Schemas

The compatibility review generates TypeScript and JSON Schema artifacts for the app-server contract.
Review Settings > Build Environment to see the schema paths. Automation should not be considered
ready if schema generation fails.

## Config Schema Validation

The app validates generated Codex config with strict config loading before enabling automation.
Config validation failures keep Build Environment in a blocked or partial state.

## Managed Hook And Config Ownership

The app writes only marked managed sections. User-managed Codex config or hook files without app
markers are treated as ownership conflicts. Use the setup rerun actions to regenerate managed files
only after reviewing the conflict.

Hooks are guardrails and callbacks. They are not a security boundary.

## Android Toolchain

Android SDK, Gradle, JDK, emulator images, AVDs, Python, image tools, archive tools, and keystore
tools are installed during first-run setup into `/app/data/toolchains`. Active projects keep their
assigned toolchain snapshot unless the operator upgrades them intentionally.

## MCP, Skill, And Agent Wiring

Required MCP servers are installed during the wizard. Product-owned Android/Kotlin skills and review
agents are bundled or copied into app-managed capability directories. Optional credentialed MCPs
remain disabled until the operator supplies credentials.

## Memory And Resource Thresholds

The job runner checks memory, disk, CPU/load policy, and timeout settings before starting work.
When resources are low, jobs move to `waiting_resources` and are rechecked at the configured interval.

## Artifact Retention

Run logs, JSONL, stderr, final messages, reports, generated schemas, screenshots, and exports are
artifact-managed. Project ZIP exports and notification bodies may contain sensitive material even
after redaction, so retention policy must match the deployment's trust boundary.
