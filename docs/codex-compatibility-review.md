# Codex Compatibility Review

The running app generates the authoritative compatibility report at
`/app/data/artifacts/codex-compatibility-review.md` during setup or when an admin runs the Build
Environment verification action.

## Current Implementation

- Codex automation is blocked until `codex exec --json` can run successfully inside the app
  container.
- Smoke runs use `--skip-git-repo-check` because the review workspace is a temporary empty
  directory, and `--dangerously-bypass-hook-trust` because the app already vets the generated hook.
- The review records `codex --version`, `codex exec --help`, `codex --help`, app-server schema
  generation, strict config loading, hook ownership, Stop hook callback recording, and JSONL parser
  coverage.
- Smoke-test JSONL, stderr, and `--output-last-message` outputs are stored as artifacts.
- Generated app-server TypeScript and JSON Schema files are stored under app data and recorded as
  compatibility artifacts.
- Codex auth and managed config live under app data `codex-home`, outside all project workspaces.
- If Codex auth is missing, expired, or the CLI is unavailable, Build Environment remains not ready.

## Official OpenAI Documentation Basis

- Non-interactive mode: `https://developers.openai.com/codex/non-interactive-mode`
- App Server schema generation: `https://developers.openai.com/codex/app-server`
- Configuration Reference: `https://developers.openai.com/codex/config-reference`
- Hooks and Stop lifecycle callbacks: `https://developers.openai.com/codex/hooks`

## Remaining Follow-Up

- Phase 10 will index official Codex documentation through mobile-docs MCP.
- Later runner phases will attach project-specific supervisor and worker output schemas.
- MCP-required support remains intentionally false until the MCP installation wizard phase verifies
  required servers.
