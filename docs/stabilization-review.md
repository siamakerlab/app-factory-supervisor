# MVP Stabilization Review

This document records the deterministic stabilization checks used before treating the MVP as ready
for long-running Android/Kotlin projects.

## Automated Simulations

- 200-turn stub Codex project: `src/server/stabilization/simulations.test.ts`
- Worker budget exhaustion: `src/server/stabilization/simulations.test.ts`
- Memory, disk, CPU, and load pressure waiting: `src/server/jobs/service.test.ts`
- Codex, Gradle/build, MCP tool, project export, test, and emulator timeout policy:
  `src/server/stabilization/simulations.test.ts`
- Missing heartbeat and timeout restart recovery: `src/server/stabilization/simulations.test.ts`
- Missed Stop hook maximum delay: `src/server/stabilization/simulations.test.ts`
- Project ZIP export path filtering and keystore inclusion policy:
  `src/server/exports/service.test.ts` and `src/server/stabilization/simulations.test.ts`
- Password failure/fail2ban log format: `src/server/auth/service.test.ts`
- Terminal status evidence guard: `src/server/stabilization/simulations.test.ts` and
  `src/server/supervisor/completionGate.test.ts`
- Job runner evidence guard: jobs without explicit handlers fail or retry instead of being marked
  succeeded without execution evidence.

## Operator-Visible Areas Reviewed

- Settings tabs: user/password, email, build environment, credentials, defaults, resources,
  security, and fail2ban records.
- Project detail sections: overview, history, checklist, runs, artifacts, exports, completion gate,
  Git automation, and supervisor instruction input.
- Terminal statuses: production ready with user action, blocked needs user, budget exhausted, failed,
  cancelled, and running.

## Known MVP Limits

- The 200-turn simulation uses stubbed Codex state, not real Codex execution.
- Emulator and screenshot verification are reserved for generated Android app QA phases, not roadmap
  implementation phases.
- Backup/restore dry-run is documented in `docs/operations.md`; production operators should run it
  against their own volume names before relying on backups.
