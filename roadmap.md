# App Factory Supervisor Roadmap

## Fixed Decisions

This roadmap implements `mvp.md` without intentional omissions.

Technical stack:

- Language: TypeScript
- Runtime: Node.js LTS
- Web app: React + Vite
- Router/state: TanStack Router + TanStack Query
- UI: Tailwind CSS + Radix UI primitives + lucide-react icons
- Backend: Fastify API server
- Database: PostgreSQL
- ORM/migrations: Drizzle ORM + drizzle-kit
- Job queue: PostgreSQL-backed job runner implemented in the app, using `jobs`, `project_locks`, `process_heartbeats`, and `resource_checks`
- Codex execution: Node `child_process.spawn` running `codex exec --json --yolo`
- Worker execution model: same app container, internal child process per Codex run
- Deployment: single Docker Compose file with `app` and `postgres` services
- Project export format: ZIP
- Project license: LGPL, using SPDX `LGPL-3.0-or-later` unless the user later selects a different LGPL version

Rationale:

- Fastify + React keeps the app explicit and easy to operate inside one container.
- PostgreSQL remains the only durable service and supports jobs, locks, audit, and roughly 100 stored projects.
- Drizzle gives typed schema ownership without hiding SQL details that matter for this product.
- TanStack Query fits a dense developer dashboard with frequent status polling.
- ZIP is the required export format and is easiest for users to download and inspect across platforms.

## Roadmap Rules

- The supervisor only decides the next prompt to send to the worker.
- The supervisor does not edit code, inspect source files directly, perform code review directly, run verification directly, or do market research directly.
- If review, verification, research, screenshot analysis, final readiness judgment, or code inspection is needed, the supervisor asks the worker to perform that task.
- Supervisor prompts are short, direct, and capped at 300 words.
- Worker final responses may offer next actions as `A`, `B`, `C`, `D`, `E`, `F`, `G`.
- The supervisor may answer with only an option letter when unambiguous.
- Worker final responses are claims, not proof.
- PostgreSQL stores only supervisor prompts sent to the worker, worker final responses, summaries, states, and artifact references. Full JSONL/stdout/stderr are files.
- Emulator/device verification is not run during roadmap planning, roadmap audit, normal implementation, or roadmap-code gap review.
- Emulator/device verification is allowed only in the dedicated QA/emulator phase, before terminal readiness, or when the user explicitly asks.
- New jobs wait when memory, disk, CPU, or load is outside thresholds, then recheck every 60 seconds.
- Full project exports include project-local ignored files and `keystores/`.

## Phase 0: Repository And Product Baseline

Goal: establish the implementation repository, conventions, and source-of-truth documents.

Tasks:

- Create the application repository structure from `mvp.md`.
- Add `roadmap.md` as the implementation plan.
- Add `docs/` placeholders for architecture notes, compatibility reports, and operational runbooks.
- Add root `README.md` with local development and Docker Compose commands.
- Add root license metadata using SPDX `LGPL-3.0-or-later`.
- Add `.gitignore` covering Node, build outputs, local data, project exports, and secrets.
- Add formatting and linting configuration.
- Add TypeScript strict configuration.
- Add package scripts for dev, build, lint, typecheck, test, migrate, and start.

Acceptance criteria:

- `npm run typecheck` works on the scaffold.
- `npm run lint` works on the scaffold.
- `docker compose config` validates.
- `mvp.md` and `roadmap.md` are both present.
- License metadata identifies the project as LGPL.

## Phase 1: Single Compose Runtime

Goal: deliver a single Compose deployment for app and PostgreSQL.

Tasks:

- Create `Dockerfile` for the TypeScript app.
- Create `docker-compose.yml` with `app` and `postgres` services.
- Mount persistent volumes:
  - `/app/data`
  - `/app/projects`
  - PostgreSQL data volume
- Add environment file template.
- Add app health endpoint.
- Add PostgreSQL healthcheck.
- Add app startup sequence:
  - load config
  - connect to PostgreSQL
  - run migrations
  - start API server
  - start job runner
- Add runtime directories:
  - `/app/data/artifacts`
  - `/app/data/runs`
  - `/app/data/toolchains`
  - `/app/data/capabilities`
  - `/app/data/secrets`
  - `/app/projects`

Acceptance criteria:

- `docker compose up -d` starts the stack.
- App health endpoint returns ready only after DB migration.
- App and Postgres data persist across container restart.

## Phase 2: PostgreSQL Schema And Migrations

Goal: implement every table and index from the MVP.

Tasks:

- Implement migrations for:
  - `users`
  - `login_attempts`
  - `user_sessions`
  - `banned_ips`
  - `app_settings`
  - `projects`
  - `project_git_settings`
  - `project_version_state`
  - `toolchain_snapshots`
  - `project_toolchain_snapshots`
  - `runs`
  - `jobs`
  - `resource_checks`
  - `project_locks`
  - `process_heartbeats`
  - `timeline_events`
  - `progress_gates`
  - `user_required_items`
  - `verification_results`
  - `artifacts`
  - `project_exports`
  - `market_research`
  - `deferred_features`
  - `capability_installations`
  - `codex_doc_indexes`
  - `codex_compatibility_reviews`
  - `secrets`
  - `notifications`
- Implement FK constraints for artifact and secret references.
- Implement indexes from the MVP, including jobs, resource checks, timeline, artifacts, verification, market research, and progress gates.
- Add enum/check constraints for key status fields.
- Add migration runner on app startup.
- Add seed for singleton `app_settings`.

Acceptance criteria:

- Empty DB migrates successfully.
- Re-running migrations is idempotent.
- FK constraints prevent dangling artifact/secret references.
- App startup fails closed when migrations fail.

## Phase 3: Configuration And App Settings

Goal: centralize durable runtime settings.

Tasks:

- Implement typed settings service backed by `app_settings`.
- Support defaults:
  - max execution hours: 24
  - max worker turns: 200
  - login failures before ban: 3
  - minimum free memory: 2048 MB
  - minimum available memory: 15%
  - minimum free disk: 10240 MB
  - maximum CPU usage: unset until operator configures it
  - maximum load average: unset until operator configures it
  - memory recheck interval: 60 seconds
  - resource recheck interval: 60 seconds
  - stale heartbeat threshold: 180 seconds
  - active worker poll interval: 300 seconds
  - Codex turn timeout: 3600 seconds
  - build timeout: 1800 seconds
  - test timeout: 1800 seconds
  - MCP tool timeout: 120 seconds
  - project ZIP export timeout: 1800 seconds
  - emulator/device timeout: 3600 seconds
  - email notifications disabled
- Add Settings API for reading/updating non-secret settings.
- Add validation for unsafe settings.
- Keep execution, resource, timeout, polling, fail2ban, and email defaults in one typed settings source.
- Add audit events for settings changes.

Acceptance criteria:

- Settings survive restart.
- Settings validation rejects invalid memory, disk, CPU/load, retry, timeout, polling, and execution limit values.
- Settings API never returns secret values.

## Phase 4: Single-User Authentication

Goal: implement single admin account and session security.

Tasks:

- Build first-run account creation:
  - admin id
  - password
  - password confirmation
- Store only password hash.
- Implement login/logout.
- Implement `user_sessions` with hashed session token.
- Implement password change in Settings.
- Block all non-setup routes until admin account is configured.
- Record every login attempt:
  - timestamp
  - IP
  - user agent
  - success/failure
  - reason
- Add session display in Settings.

Acceptance criteria:

- No public signup exists.
- Exactly one admin account is supported.
- Password change invalidates or rotates sessions according to policy.
- Failed login attempts are visible in Settings.

## Phase 5: Fail2ban Integration

Goal: support 3-failure IP ban through host-level fail2ban.

Tasks:

- Emit stable auth failure log lines:
  - `AUTH_FAIL ip=<ip> admin_id=<admin_id> reason=<reason>`
- Add fail2ban filter template.
- Add fail2ban jail template.
- Add trusted proxy configuration.
- Add Settings tab for Fail2ban Records:
  - failed attempts
  - successful attempts
  - banned IPs
  - ban reason
  - ban timestamp
  - expiration
  - source log excerpt or audit id
- Add setup warning when externally exposed without trusted proxy/IP configuration.

Acceptance criteria:

- Three failed password attempts produce parseable auth logs.
- UI shows login attempts and known banned IPs.
- Docs explain host-level fail2ban with bind-mounted auth log.

## Phase 6: Dense Developer Web UI Shell

Goal: create the information-dense developer web app layout.

Tasks:

- Build left sidebar with:
  - Projects
  - Build Environment
  - Settings
- Pin app version and logout at sidebar bottom.
- Exclude Wizard from sidebar.
- Implement responsive dense layout for desktop-first developer workflow.
- Use compact tables, tabs, status chips, progress bars, and expandable details.
- Use lucide icons for common actions.
- Avoid marketing/landing-page UI.

Acceptance criteria:

- First viewport is the actual app dashboard.
- Sidebar matches MVP navigation.
- UI remains dense and readable at common desktop sizes.

## Phase 7: Settings UI

Goal: implement tabbed Settings.

Tasks:

- Add tabs:
  - User And Password
  - Email Notifications
  - Build Environment
  - Credentials And Secrets
  - Default Project Limits
  - Resource Limits
  - Security And Safety
  - Fail2ban Records
- User And Password:
  - admin id display
  - password change
  - session information
- Email Notifications:
  - SMTP/provider settings
  - recipient
  - test email
  - terminal status toggle
- Build Environment:
  - Android SDK
  - Gradle
  - JDK
  - toolchain snapshots
  - AVD/emulator
  - MCP status
  - skill/agent wiring
  - Codex CLI/auth/JSONL dry-run/compatibility status
  - rerun setup/verification
- Credentials And Secrets:
  - Git SSH public key
  - uploaded secret files
  - API key placeholders
  - Play Console credentials
  - AdMob identifiers
  - keystore references
- Default Project Limits:
  - max execution hours
  - max worker turns
  - retry limits
  - default memory thresholds
- Resource Limits:
  - CPU/memory limits
  - current memory status
  - free/available memory thresholds
  - 60-second recheck interval
  - process limits
  - worker timeout
  - stale heartbeat threshold
  - artifact retention
  - export retention
- Security And Safety:
  - trusted proxy
  - external exposure warnings
  - hook trust
  - yolo/process isolation status
  - secret redaction
  - same-container worker safeguards
  - host fail2ban integration
- Fail2ban Records:
  - failed/success logins
  - banned IPs
  - reasons and timestamps

Acceptance criteria:

- Every Settings tab from MVP exists.
- Secret values are never displayed after save.
- Build Environment clearly reports readiness blockers.

## Phase 8: First-Run Setup Wizard

Goal: implement the first-run wizard shell and block project execution until global setup is complete.

Tasks:

- Implement setup completion detection.
- Wizard step 1: admin id/password setup.
- Wizard step 2: deployment/build environment install.
- Wizard step 3: show generated SSH public key and explain Git host registration.
- Treat this phase as the wizard orchestration/UI layer.
- Wire the executable setup actions delivered by Phases 9 through 12 into wizard step 2.
- Detect OS and CPU architecture.
- Choose persistent install paths.
- Configure environment variables.
- Verify commands:
  - `codex --version`
  - `git --version`
  - `node --version`
  - `python3 --version`
  - `java -version`
  - `gradle --version`
  - `sdkmanager --list`
  - `adb version`
  - emulator availability
  - AVD creation
  - debug keystore
- Allow retrying failed steps.
- Persist setup results and installed versions.

Acceptance criteria:

- Project creation is blocked until wizard passes.
- Wizard cannot pass until Codex, Android toolchain, docs indexing, MCPs, skills, and agents from Phases 9 through 12 are ready or explicitly marked optional.
- Wizard can resume after failure.
- SSH private key is never shown.

## Phase 9: Codex Authentication And Compatibility

Goal: prove Codex can run non-interactively before automation starts.

Tasks:

- Verify Codex auth is usable inside the app container.
- Run a temporary `codex exec --json` smoke test.
- Verify help includes:
  - `--json`
  - `--output-schema`
  - `--output-last-message`
  - `resume`
- Verify `codex app-server generate-ts` works for the installed Codex version.
- Verify `codex app-server generate-json-schema` works for the installed Codex version.
- Save generated app-server TypeScript schemas.
- Save generated app-server JSON Schemas.
- Record generated schema paths and Codex CLI version.
- Validate generated Codex `config.toml` against the current Codex config schema.
- Verify hooks config can load.
- Detect app-managed versus user-managed Codex config/hook ownership conflicts.
- Verify Stop hook callback reaches backend.
- Verify JSONL parser recognizes current event names.
- Save compatibility review artifact:
  - `docs/codex-compatibility-review.md`
- Re-run compatibility review after Codex CLI upgrades.
- Keep Codex auth files outside project workspaces.

Acceptance criteria:

- Build Environment is not ready when Codex auth is missing/expired.
- Smoke test stores JSONL and last-message artifacts.
- Generated app-server schemas are stored as compatibility artifacts.
- Generated `config.toml` passes schema validation.
- Managed config/hook ownership report is visible in Build Environment.
- Compatibility review status is visible in Settings.

## Phase 10: Codex Documentation Indexing

Goal: index official Codex docs using `mobile-docs`.

Tasks:

- Install/register `mobile-docs` MCP from `siamakerlab/mobile-docs-mcp-server` in setup wizard.
- Index official Codex docs for:
  - Codex CLI
  - non-interactive mode
  - `codex exec`
  - JSONL output
  - `--output-schema`
  - `--output-last-message`
  - hooks
  - Stop hook
  - SessionEnd hook
  - MCP configuration
  - `config.toml`
  - security/sandbox/approvals/network policy
  - skills/plugins
  - Codex SDK
  - Codex app-server
  - developer commands
  - changelog/breaking changes
  - best practices
  - `AGENTS.md`
- Save:
  - indexed URL list
  - document count
  - unique URL count
  - timestamp
  - search smoke-test result
  - Codex CLI version
  - generated app-server TypeScript schema path
  - generated app-server JSON Schema path
  - generated config validation result
  - managed config/hook ownership report
  - gap report
- Store in `codex_doc_indexes` and `codex_compatibility_reviews`.

Acceptance criteria:

- Setup fails or marks Build Environment not ready when required Codex docs are not indexed.
- `openai-codex` index is queryable.
- Compatibility review references indexed docs.

## Phase 11: Android Toolchain Installer

Goal: install Android development tooling at first run, not pre-bundled in image.

Tasks:

- Install Android SDK command-line tools.
- Install platform tools.
- Install build tools.
- Install latest stable Android platform package resolved at setup time.
- Install Android emulator.
- Install AVD system image.
- Support AVD creation and launch.
- Install latest stable Gradle resolved at setup time.
- Install compatible JDK.
- Install Git, Node/npm, Python 3.
- Install image processing tools.
- Install Base64 and archive utilities.
- Install keystore/signing tools.
- Install Playwright browser dependencies and Chromium.
- Create debug keystore when appropriate.
- Create `toolchain_snapshots`.
- Assign snapshot to projects at creation time.
- Never upgrade active project toolchains mid-run.

Acceptance criteria:

- Toolchain snapshot is created after setup.
- New projects receive a fixed toolchain snapshot.
- Existing projects keep their assigned snapshot unless user requests upgrade.

## Phase 12: Capability Installer

Goal: install MCP servers, skills, and agents according to MVP defaults.

Tasks:

- Do not install App Factory Autopilot defaults.
- Do not install Sequential Thinking MCP by default.
- Any review skill with a similar name to an App Factory Autopilot skill must be installed only as a product-owned bundled copy or explicit repository dependency, never by enabling the App Factory Autopilot plugin/default set.
- Install default MCPs through wizard:
  - `mobile-docs` from `siamakerlab/mobile-docs-mcp-server`
  - `context7`
  - `mobile-mcp`
  - `playwright`
  - `memory`
  - `time`
- Support optional credentialed MCPs disabled until credentials exist:
  - `github`
  - `play-store-mcp`
  - `app-publish`
  - `firebase`
  - `sentry`
- Support optional advanced MCPs:
  - `code-review-graph`
  - DB MCPs
  - fetch/search MCPs
- Write MCP config to Codex `config.toml`.
- Validate generated `config.toml` against the Codex config schema.
- Keep app-managed config sections clearly marked.
- Detect user-managed config sections and never silently overwrite them.
- Use `required = true` for required MCPs.
- Configure startup/tool timeouts.
- Configure enabled/disabled tools where needed.
- Store package, source, version, revision, status.
- Wire bundled product-owned worker implementation skills:
  - `material-3`
  - `material3-expert`
  - `compose-expert`
  - `jetpack-compose-expert`
  - `compose-architecture-expert`
  - `adaptive`
  - `adaptive-layout-expert`
  - `edge-to-edge`
  - `navigation-3`
  - `kotlin-expert`
  - `android-testing`
  - `testing-setup`
  - `android-bug-finder`
  - `build-failure-debugger`
  - `r8-analyzer`
  - `play-billing`
  - `admob-agent-skill`
  - `play-policy-insights`
  - `perfetto-sql`
  - `perfetto-trace-analysis`
- Wire worker review skills when they do not depend on App Factory Autopilot internals:
  - `project-explore`
  - `dependency-version-review`
  - `placeholder-audit`
  - `completion-verify`
  - `final-gate`
  - `license-compliance-review`
  - `license-report`
  - `qa-scenario-writer`
- Treat existing `factory-*`, `roadmap-*`, and `app-factory-*` skills as reference material only, not default installed capabilities.
- Wire worker-invoked review agents:
  - `repo-cartographer`
  - `requirements-analyst`
  - `product-planner`
  - `gap-analysis-reviewer`
  - `android-architecture-reviewer`
  - `data-layer-reviewer`
  - `coroutine-flow-reviewer`
  - `navigation-ux-reviewer`
  - `accessibility-reviewer`
  - `privacy-permission-reviewer`
  - `security-reviewer`
  - `performance-reviewer`
  - `empty-error-loading-state-reviewer`
  - `screenshot-regression-reviewer`
  - `release-packaging-reviewer`
  - `android-test-engineer`
  - `build-failure-debugger`
- Install review agents as worker-invoked evaluation perspectives, not independent implementers.
- Download repository-owned skills/agents during wizard.
- Copy bundled skills/agents from the image into persistent Codex capability directories.
- Validate `SKILL.md` frontmatter and agent metadata.
- Preserve user-edited skills/agents unless the user explicitly chooses overwrite.
- Record source type:
  - `bundled`
  - `repository`
  - `user`
- Make worker review skills available to worker.
- Supervisor may only prompt worker to use review skills.
- Supervisor never invokes skills or agents directly.

Acceptance criteria:

- Required MCPs pass smoke tests.
- Capability install state is visible in Build Environment.
- App Factory Autopilot and Sequential Thinking are absent from default install.

## Phase 13: Project Wizard

Goal: create new/existing project records with all required fields.

Tasks:

- Project wizard order:
  - project name, app name, package name
  - short user app plan
  - new/existing project
  - new: empty Git repo URL
  - existing: existing repo URL
  - new: release keystore creation
  - existing: release keystore upload later
- Required fields:
  - project name
  - app name
  - package name
  - user app plan
  - project type
  - repository URL
  - global Git user.name
  - global Git user.email
  - max execution hours
  - max worker turns
- Write global Git config in persistent runtime.
- Generate/reuse SSH key pair.
- Show public key and Git host registration help.
- Verify remote reachability after SSH key registration.
- New project:
  - create project workspace
  - create release keystore
  - store keystore in project `keystores/`
  - store keystore passwords only through secret storage
  - first prompt asks worker to create `mvp.md` and `roadmap.md`
  - first prompt includes the user's short app plan as source direction
- Existing project:
  - clone repository
  - first prompt asks worker to inspect planning docs, implementation, build, verification state
  - worker reports roadmap usability and implementation level
  - no restart from scratch unless user requests

Acceptance criteria:

- New and existing project flows both create durable project state.
- Missing Git access leads to `BLOCKED_NEEDS_USER` through backend completion gate.
- Keystore files are ignored from Git but included in project export.

## Phase 14: Project State, Versioning, And Git Automation

Goal: track project lifecycle and automatic versions.

Tasks:

- Implement project statuses:
  - `running`
  - `production_ready_user_action_required`
  - `blocked_needs_user`
  - `failed`
  - `budget_exhausted`
  - `cancelled`
- Implement progress phases:
  - product definition
  - market review
  - roadmap planning
  - UX planning
  - implementation
  - gap review
  - QA planning
  - emulator verification
  - code review
  - production ready
- Implement version format:
  - `major.minor.patch+yymmddrrr`
- Define a unit of work as one scoped worker task, roadmap item, bug fix, review fix batch, documentation update, setup change, or verification artifact update.
- Commit automatically after every completed unit of work when there are file changes.
- Allow multiple unit-of-work commits in one worker turn when the completed changes are clearly separable.
- Commit partial work only when it is useful, buildable where applicable, and clearly marked in the commit message.
- Patch increments per completed unit-of-work commit.
- Minor increments after meaningful feature/phase completion.
- Major increments only for explicit major milestones or breaking direction changes.
- Do not commit failed turns with no useful changes.
- Commit messages include:
  - unit type
  - scope
  - version
  - verification tier when available
- Fix bad changes forward or revert through scoped worker prompt.
- Push after:
  - planning phase completion
  - roadmap audit completion
  - implementation milestones
  - QA/stabilization milestones
  - terminal status
- Push includes all unit-of-work commits completed in that phase.
- If push fails, keep local commits and mark the project as needing retry or Git user action according to error type.
- Never push ignored sensitive directories.

Acceptance criteria:

- Version state persists.
- Commit messages include version identifier.
- Every completed unit of work with file changes creates an automatic local commit.
- Push policy is phase-based, not every turn.

## Phase 15: Artifact Storage

Goal: store large payloads on filesystem and metadata in PostgreSQL.

Tasks:

- Store raw Codex JSONL as files.
- Store stdout/stderr as files.
- Store build logs, screenshots, APKs, AABs, reports, attachments as files.
- Store artifact metadata:
  - path
  - SHA-256
  - size
  - type
  - project
  - run
  - redaction flag
  - retention metadata
- Implement artifact content endpoint.
- Implement artifact redaction markers.
- Implement artifact retention:
  - compress old JSONL/build logs
  - keep latest release APK/AAB for terminal projects
  - cleanup dry-run
  - max retained run logs per project
  - never delete final report evidence unless user confirms
- Implement backup/restore manifest requirements.

Acceptance criteria:

- Large payloads are not stored in DB.
- Artifact links in UI resolve.
- Cleanup cannot silently remove terminal evidence.

## Phase 16: Project Full-Folder ZIP Export

Goal: allow the user to download the entire project folder at any time.

Tasks:

- Add `Download Project` action to project detail.
- Add API:
  - request full project export
  - get export status
  - download export
  - delete export
- Add `project_export` job type.
- Add `project_exports` state handling.
- Generate ZIP from filesystem project root, not Git.
- Include:
  - all source files
  - gitignored files inside project folder
  - `keystores/`
  - signing files
  - project-local sensitive files
- Exclude:
  - app-global secrets
  - Codex auth
  - PostgreSQL data
  - other projects
  - global tool caches
- Preserve relative paths and permissions where practical.
- Calculate:
  - file count
  - size
  - SHA-256
- Store ZIP as artifact type `project_export`.
- Mark exports sensitive.
- Use authenticated, short-lived download URLs.
- Record export creation and download audit logs.
- Never email export archives.
- Expire/delete old exports according to retention settings.
- Obey memory pressure checks before archive creation.

Acceptance criteria:

- User can download project ZIP while project is running.
- ZIP includes project-local `keystores/`.
- ZIP excludes app-global secrets and other projects.
- UI shows export status, size, checksum, and expiration.

## Phase 17: Job Runner, Locks, Resource Monitor, And Watchdog

Goal: safely run long automation without duplicate workers, overload, hangs, or unrecoverable stale jobs.

Tasks:

- Implement PostgreSQL-backed job runner.
- Implement job statuses:
  - queued
  - waiting_resources
  - running
  - succeeded
  - failed
  - cancelled
  - stale
- Implement project locks.
- Enforce one active worker run per project.
- Implement process heartbeats.
- Detect stale jobs/processes.
- Implement resource checks before:
  - supervisor turn
  - worker turn
  - verification
  - build
  - emulator
  - project export
- Resource checks include:
  - memory
  - disk free space
  - CPU usage
  - load average
- Default resource thresholds:
  - min free memory 2048 MB
  - min available memory 15%
  - min free disk 10240 MB
  - recheck interval 60 seconds
  - stale heartbeat threshold 180 seconds
- Implement hard timeout matrix:
  - Codex turn 3600 seconds
  - build 1800 seconds
  - tests 1800 seconds
  - MCP tool call 120 seconds
  - project ZIP export 1800 seconds
  - emulator/device verification 3600 seconds
- Store `timeout_at`, `stale_after`, `heartbeat_at`, and `resource_wait_reason` for jobs.
- Store active worker poll interval, default 300 seconds.
- Poll active worker runs every 5 minutes by default even when Stop hook has not fired.
- Worker polling checks:
  - child process liveness
  - heartbeat freshness
  - timeout deadline
  - JSONL growth
  - `--output-last-message` file existence
  - exit status
  - output artifact timestamps
- Use container cgroup memory/CPU metrics when available.
- Fall back to `/proc/meminfo`, filesystem stats, and load average.
- Do not kill already running worker only because resources become pressured.
- Keep project running while waiting unless budget expires or user cancels.
- Stop as `BUDGET_EXHAUSTED` if waiting persists until time limit.
- On app startup, inspect queued/running/waiting jobs.
- Mark jobs stale when no live child process or fresh heartbeat exists.
- Release expired project locks.
- Resume 60-second checks for `waiting_resources` jobs.
- Parse partial artifacts from disappeared processes when available.
- Route recovery through retry policy or the next worker prompt.
- If polling detects a finished worker without Stop hook, record completion and wake the supervisor loop.
- Expose stuck states in UI:
  - resource wait
  - timeout
  - stale
  - disk low
  - CPU high
  - load high
  - heartbeat missing

Acceptance criteria:

- Duplicate worker runs cannot start for one project.
- Memory, disk, CPU, or load pressure blocks new jobs and rechecks every 60 seconds.
- Waiting reason is visible in project UI.
- Timed-out jobs are terminated or marked stale with artifacts preserved.
- App restart recovers queued/running/waiting jobs deterministically.
- Missing Stop hook does not block supervisor continuation beyond the polling interval.

## Phase 18: Codex Runner

Goal: run supervisor and worker Codex sessions in JSON mode.

Tasks:

- Implement command builder for:
  - `codex exec`
  - `--json`
  - `--yolo`
  - `--dangerously-bypass-hook-trust`
  - `--output-schema`
  - `--output-last-message`
  - `-C "$PROJECT_DIR"`
- Run worker and supervisor as internal same-container child processes.
- Use CLI JSONL as the primary MVP orchestration path.
- Keep runner abstraction thin so Codex SDK or app-server can be evaluated later without redesigning jobs/artifacts.
- Use explicit environment allowlist.
- Use project working directory.
- Apply timeout enforcement.
- Capture:
  - JSONL stdout
  - stderr
  - exit code
  - start/end timestamps
  - prompt artifact
  - working directory
  - Codex thread id when available
  - role
- Store full logs as artifacts.
- Store only supervisor prompt and worker final response in PostgreSQL timeline.
- Do not store every intermediate Codex message in DB.

Acceptance criteria:

- Worker run produces artifacts and DB run record.
- Supervisor prompt under 300 words is recorded exactly.
- One-letter supervisor prompts are accepted and recorded.

## Phase 19: Hooks

Goal: use Codex hooks as callbacks and guardrails, not as the security boundary.

Tasks:

- Configure Stop hook.
- Configure SessionEnd hook for advisory cleanup.
- Generate hooks into app-managed files or clearly marked app-managed sections.
- Include owner, generated timestamp, app version, and Codex CLI version metadata in managed hook/config content.
- Detect conflicts with user-edited hooks/config and require confirmation or regeneration.
- Show managed versus user hook/config ownership in Settings.
- Stop hook calls backend on turn stop.
- Backend also watches child process directly.
- Backend polls active worker state every 5 minutes by default as a Stop hook fallback.
- Stop hook output is JSON on success.
- Do not rely on Stop hook continuation for main loop.
- Use hooks for:
  - backend notification
  - supervisor no-code guardrail
  - accidental secret exposure guardrail
  - ignored sensitive path guardrail
  - setup context on session start

Acceptance criteria:

- Hook failure does not lose worker completion.
- Backend process watcher can complete the run without hook callback.
- Worker polling detects completed runs when both hook callback and immediate process notification are missed.

## Phase 20: JSONL Parser

Goal: parse Codex JSONL into summaries without depending on unstable transcript internals.

Tasks:

- Parse event categories:
  - `thread.started`
  - `turn.started`
  - `turn.completed`
  - `turn.failed`
  - `item.*`
  - `error`
- Persist token usage when available.
- Extract final Codex message.
- Extract failed commands/tool executions.
- Tolerate unknown fields.
- Treat event schemas as version-sensitive.
- Do not rely on transcript file format as stable API.
- Treat `codex exec resume` as optional recovery, not main loop.

Acceptance criteria:

- Unknown JSONL fields do not crash parser.
- Parser emits concise run summary for UI/backend.

## Phase 21: Timeline And Project Detail UI

Goal: show progress and history without a terminal console.

Tasks:

- Implement project detail sections:
  - progress overview
  - supervisor/worker timeline history
  - worker latest response
  - current supervisor decision/next prompt
  - verification status
  - user-required checklist
  - supervisor instruction input
  - recent artifacts
  - project download/export
  - final status summary
- Progress bar derives from gates, not elapsed time.
- Show gates from MVP:
  - requirements clarified
  - MVP drafted
  - market/competitor review completed
  - MVP revised
  - roadmap drafted
  - roadmap audit passes
  - deferred items
  - frontend/UX plan
  - phone/foldable/tablet layout plan
  - scaffold ready
  - core features
  - UI states
  - persistence/networking
  - roadmap-code gap review
  - Android build
  - tests
  - QA scenario plan
  - emulator/device scenario tests
  - screenshot review
  - phone/foldable/tablet verification
  - full-code review
  - placeholders cleared
  - permissions/privacy
  - signing/release packaging
  - docs/runbook
  - external user actions
- Timeline stores only:
  - supervisor prompt sent to worker
  - worker final response
  - metadata/artifact links
- Timeline sequence:
  - supervisor prompt
  - worker final response
  - next supervisor prompt
  - next worker final response
- Show latest worker response as compact summary.
- Worker response is marked claim, not proof.

Acceptance criteria:

- UI shows alternating history.
- No terminal console exists.
- User can inspect prompt/response/artifact lineage.

## Phase 22: User-Required Checklist

Goal: track external information/actions that only the user can provide.

Tasks:

- Implement checklist examples:
  - app name
  - package name
  - target audience
  - permissions
  - privacy policy URL
  - API keys
  - OAuth setup
  - AdMob IDs
  - Play Console service account
  - production signing key
  - DNS/domain
  - legal/policy approval
- Track:
  - status
  - required for production
  - can continue without it
  - secret flag
  - secret id
  - last validation
- Provide safe upload/input controls.
- Never include sensitive values in prompts, JSONL, logs, emails.

Acceptance criteria:

- Checklist influences `BLOCKED_NEEDS_USER` and final user action summary.
- Secret checklist items are stored through secret storage only.

## Phase 23: Supervisor Direct Instruction Input

Goal: let user steer supervisor without directly prompting worker.

Tasks:

- Add prompt input on project screen.
- Support:
  - plain text instruction
  - optional attachment reference
  - priority marker
  - apply after current worker run
- Supervisor reads instruction with backend state.
- Supervisor decides whether it changes next prompt.
- Record instruction in project history.
- Never send user instruction directly to worker without supervisor prompt generation.

Acceptance criteria:

- User can queue instruction during active worker run.
- Instruction appears in timeline/history.

## Phase 24: Supervisor Prompt Selection

Goal: implement the simplified supervisor role.

Tasks:

- Supervisor reads:
  - worker final response
  - backend run summary
  - progress state
  - artifact links
  - checklist summary
- Supervisor outputs:
  - next worker prompt
  - or short no-op/final-summary request when needed
- Supervisor never:
  - edits source
  - runs verification
  - performs code review
  - performs market research
  - directly inspects source files
  - performs hidden manual analysis
- If code review is needed, supervisor prompts worker to review code.
- If verification is needed, supervisor prompts worker to perform or coordinate it.
- If market research is needed, supervisor prompts worker to research.
- If terminal evidence is near, supervisor prompts worker for final summary/final verification.
- Enforce prompt limit:
  - max 300 words
  - concise objective
  - concrete task
  - acceptance criteria
  - verification tier if relevant
- Support worker options:
  - worker offers `A` through `G`
  - supervisor may answer with only `A`
  - backend records exact prompt

Acceptance criteria:

- Supervisor cannot call code-editing paths.
- Prompt length validation prevents over-300-word worker prompts unless explicitly overridden by system admin.
- One-letter option prompt creates a valid worker run.

## Phase 25: Worker Task Contract

Goal: standardize worker behavior.

Tasks:

- Worker task types:
  - product planning
  - market research
  - roadmap creation/audit
  - UX planning
  - implementation
  - code review
  - verification
  - bug fixing
  - screenshot analysis
  - release readiness summary
- Worker final response includes:
  - concise completed work summary
  - changed files
  - verification result
  - blockers
  - suggested next actions as `A` to `G` when useful
- Worker stops after scoped task.
- Worker does not continue into broad next phase without new supervisor prompt.

Acceptance criteria:

- Worker final responses are parseable by output schema.
- Suggested options are captured in state model.

## Phase 26: Product Lifecycle Worker Prompts

Goal: implement prompt templates that move projects from idea to production readiness.

Tasks:

- Product definition prompt:
  - clarify core purpose
  - expected user value
  - minimum usable product
  - required/optional features
  - assumptions/open questions
- Market review prompt:
  - web search
  - Play Store search
  - communities/forums/reviews
  - at least 5 relevant Play Store competitors when available
  - at least 3 community sources when available
  - source URL/query/region/language/date/title/summary
  - separate evidence from inference
- Roadmap prompt:
  - roadmap order
  - contradictions
  - realism
  - dependencies
  - risks
  - scope creep
  - cost vs value
  - competitor feature coverage
  - deferred rationale
- UX planning prompt:
  - domain-appropriate UI
  - main flows
  - empty/loading/error/retry/success states
  - navigation/back/gestures
  - accessibility basics
  - phone/foldable/tablet/landscape/large-screen
- Implementation prompt:
  - one roadmap item or coherent task
  - exact files/areas
  - acceptance criteria
  - verification tier
- Gap review prompt:
  - MVP vs roadmap
  - roadmap vs implemented code
  - implemented code vs user behavior
  - planned UX vs screens
  - deferred vs production requirements
- QA scenario prompt:
  - core features
  - screens
  - buttons
  - gestures
  - navigation/back
  - states
  - permission flows
  - data entry/validation
  - orientation/window size
  - phone/foldable/tablet
- Emulator prompt:
  - only in QA/emulator phase or explicit user request
  - phone/foldable/tablet targets
  - screenshots/logs/test output
- Code review prompt:
  - architecture
  - data layer
  - state management
  - coroutine/Flow
  - error handling
  - permissions/privacy
  - security/secrets
  - performance
  - release packaging
  - R8/ProGuard
  - dependencies
  - license/policy
  - LGPL project license compliance
- Final readiness prompt:
  - final worker evidence summary
  - remaining user-owned external actions

Acceptance criteria:

- Each lifecycle area in MVP has at least one worker prompt template.
- Prompt templates remain short and scoped.

## Phase 27: Verification Tiers

Goal: avoid token waste while preserving evidence-based progress.

Tasks:

- Implement `T0 metadata check`.
- Implement `T1 targeted static check`.
- Implement `T2 module build/test`.
- Implement `T3 full non-emulator verification`.
- Implement `T4 emulator and release readiness verification`.
- Default:
  - most turns use `T0 + T1`
  - feature completion uses `T1/T2`
  - non-QA phase gates use `T2/T3`
  - terminal readiness uses `T4`
- Block emulator/device verification during:
  - roadmap planning
  - roadmap audit
  - normal implementation
  - roadmap-code gap review
- Record tier and rationale.

Acceptance criteria:

- UI shows latest verification tier.
- Emulator jobs cannot be scheduled from roadmap progress gates.

## Phase 28: Completion Gate

Goal: set terminal status from evidence and limits.

Tasks:

- Implement backend completion gate using:
  - worker-produced evidence
  - backend run metadata
  - progress gates
  - checklist state
  - configured time/turn limits
  - job failure/retry state
- Terminal statuses:
  - `RUNNING`
  - `PRODUCTION_READY_USER_ACTION_REQUIRED`
  - `BLOCKED_NEEDS_USER`
  - `BUDGET_EXHAUSTED`
  - `FAILED`
  - `CANCELLED`
- Production-ready requirements:
  - coherent MVP
  - audited roadmap
  - implementation converged with roadmap
  - deferred items documented
  - UX plan implemented
  - phone/foldable/tablet strategy handled where applicable
  - core behavior implemented
  - no release-blocking roadmap-code gap
  - no release-blocking placeholders
  - no mock-only critical paths
  - build passes
  - tests pass or gaps accepted
  - scenario tests cover core features/screens/buttons/gestures
  - emulator/device verification passes where applicable
  - screenshot review has no unresolved UI/inset/clipping/layout defects
  - repeated worker code reviews find no new release blockers
  - package artifact exists or dry-run passes
  - README/runbook ready
  - env vars documented
  - no unresolved critical failures
  - remaining work is user-owned external setup
- Blocked user actions:
  - API keys
  - billing
  - OAuth consent
  - DNS
  - signing credentials
  - Git access
  - missing project clarification
  - legal/policy approval
  - production account access

Acceptance criteria:

- Completion gate never relies on worker final response alone.
- Final status includes evidence and remaining user actions.

## Phase 29: Sensitive Files And Secrets

Goal: keep sensitive material out of Git, logs, prompts, and emails while allowing project ZIP export.

Tasks:

- Create project `keystores/` when signing material is needed.
- Register `keystores/` in project `.gitignore`.
- Keep release/debug/user keystores, signing properties, and passwords out of Git.
- Ask worker to confirm `.gitignore` before commit, with backend secret/path scanners as guardrails.
- Store secret values through app secret storage or ignored files only.
- Never include secrets in:
  - Codex prompts
  - JSONL logs
  - screenshots
  - email notifications
  - commit messages
- Include project-local `keystores/` in full ZIP export.
- Exclude app-global secrets from ZIP export.

Acceptance criteria:

- Secret scanner rejects prompt/log/email leaks.
- Keystores are ignored by Git and present in full project ZIP.

## Phase 30: Email Notifications

Goal: send terminal email without leaking secrets or archives.

Tasks:

- Implement SMTP/provider secret setup.
- Implement recipient setting.
- Implement test email.
- Send final email on terminal status.
- Include:
  - final status
  - project path
  - completed work summary
  - verification summary
  - artifact path where safe
  - user actions required
  - failed command/log summary when failed
- Do not attach project ZIP.
- Do not include secrets.
- Record notification state.

Acceptance criteria:

- Terminal email sends once.
- Failed email is visible in Settings or project status.

## Phase 31: AGENTS.md Guidance

Goal: generate project guidance for Codex workers.

Tasks:

- Ask worker to create/update `AGENTS.md` through scoped prompt.
- Include:
  - Android/Kotlin scope
  - build/test commands
  - architecture rules
  - supervisor/worker boundaries
  - no secret rules
  - `keystores/` ignore requirement
  - done criteria
  - verification commands
  - commit/versioning rules
- Supervisor does not edit `AGENTS.md` directly.

Acceptance criteria:

- New projects receive an `AGENTS.md`.
- Existing projects are updated only by worker prompt.

## Phase 32: API Surface

Goal: provide backend endpoints required by MVP.

Tasks:

- `create project`
- `start project run`
- `stop project run`
- `get project status`
- `get project timeline history`
- `submit supervisor instruction`
- `get user-required checklist`
- `update user-required item`
- `get run history`
- `get artifact content`
- `request full project export`
- `get project export status`
- `download project export`
- `delete project export`
- `receive Codex hook callbacks`
- Settings endpoints
- Auth endpoints
- Setup wizard endpoints

Acceptance criteria:

- Every UI action has an API.
- APIs enforce single-admin auth.

## Phase 33: Build Environment Page

Goal: show operational readiness.

Tasks:

- Show Android SDK readiness.
- Show Gradle/JDK readiness.
- Show toolchain snapshots.
- Show AVD/emulator readiness.
- Show MCP status.
- Show skill/agent wiring.
- Show Codex CLI version.
- Show Codex auth.
- Show JSONL dry-run.
- Show app-server generated schema status.
- Show Codex config schema validation status.
- Show managed config/hook ownership conflicts.
- Show compatibility review.
- Show setup rerun actions.

Acceptance criteria:

- User can see why automation is blocked.
- Setup rerun does not overwrite user material without confirmation.

## Phase 34: Security Hardening

Goal: make `--yolo` acceptable inside the MVP's same-container process model.

Tasks:

- Use dedicated project working directory.
- Use explicit environment allowlist.
- Deny sensitive app-global paths.
- Do not mount app secrets into worker env.
- Keep Codex auth read-only where possible.
- Enforce timeouts.
- Enforce resource checks before launch.
- Capture artifacts.
- Redact logs where possible.
- Prevent supervisor from invoking code mutation paths.
- Treat hooks as guardrails, not security boundary.
- Validate generated Codex config before enabling automation.
- Keep app-managed hook/config sections marked and auditable.
- Prevent silent overwrite of user-managed hook/config sections.
- Document same-container limitations.

Acceptance criteria:

- Worker cannot access app-global secret paths through normal runner configuration.
- Security page shows isolation status and known limitations.

## Phase 35: Testing Strategy

Goal: verify the supervisor app itself.

Tasks:

- Unit tests:
  - settings validation
  - status transitions
  - memory threshold logic
  - disk threshold logic
  - CPU/load threshold logic
  - timeout deadline calculation
  - stale heartbeat detection
  - Codex config schema validation
  - app-managed hook/config conflict detection
  - version increments
  - JSONL parser
  - prompt length enforcement
  - option-letter prompt handling
  - export path filtering
- Integration tests:
  - migrations
  - auth/session
  - project wizard
  - job runner
  - resource waiting
  - disk-low waiting
  - CPU/load waiting
  - timeout handling
  - stale job recovery
  - restart recovery
  - generated app-server schema artifacts
  - config validation failure blocks readiness
  - managed hook/config conflict blocks readiness
  - artifact storage
  - project ZIP export
  - timeline storage
- E2E tests:
  - first-run wizard
  - login
  - create project
  - view project dashboard
  - request project export
  - settings tabs
- Stub Codex runner for deterministic tests.

Acceptance criteria:

- Tests run without real Codex for CI.
- Critical flows have integration coverage.

## Phase 36: Documentation

Goal: provide operational documentation.

Tasks:

- README:
  - install
  - compose run
  - first-run setup
  - project creation
  - export download
  - backup/restore
- Admin docs:
  - fail2ban host setup
  - trusted proxy
  - Codex auth
  - generated app-server schemas
  - config schema validation
  - managed hook/config ownership
  - Android toolchain
  - MCP/skill/agent wiring
  - memory thresholds
  - artifact retention
- Developer docs:
  - architecture
  - DB schema
  - job runner
  - Codex runner
  - prompt contracts
  - verification tiers
  - automatic unit-of-work commit and phase push policy
- Security notes:
  - same-container worker limitations
  - `--yolo` risk
  - secret handling
  - project export sensitivity
- License docs:
  - LGPL project license
  - third-party dependency license review expectations

Acceptance criteria:

- A new operator can deploy and complete first-run setup from docs.
- Known limitations are explicit.
- License expectations are explicit.

## Phase 37: MVP Stabilization

Goal: make the MVP reliable enough for long-running projects.

Tasks:

- Run a simulated 200-turn project with stub Codex.
- Run memory pressure waiting simulation.
- Run disk pressure waiting simulation.
- Run CPU/load pressure waiting simulation.
- Run Codex child process hang simulation.
- Run Gradle/build timeout simulation.
- Run MCP tool timeout simulation.
- Run project ZIP export timeout simulation.
- Run missing heartbeat stale-job simulation.
- Run missed Stop hook polling recovery simulation.
- Run app/container restart recovery simulation.
- Run failed worker retry simulation.
- Run budget exhaustion simulation.
- Run project export during active project.
- Run password failure/fail2ban log simulation.
- Run artifact retention dry-run.
- Run backup/restore dry-run.
- Review all terminal statuses.
- Review all Settings tabs.
- Review all project detail sections.

Acceptance criteria:

- No duplicate worker run starts.
- No terminal status is set without evidence.
- Full project ZIP includes `keystores/`.
- App recovers from restart with queued/running/stale job states handled.
- Hung child processes do not freeze the app indefinitely.
- Missed Stop hook delays continuation by at most the configured polling interval.
- Disk/CPU/load pressure states are operator-visible.

## Traceability Checklist

This checklist maps `mvp.md` content to roadmap coverage.

- Goal: Phases 24, 28, 30, 37
- Core Idea: Phases 18, 24, 25, 28
- Project License: Phases 0, 26, 35, 36
- Codex Invocation: Phases 9, 18, 19, 20
- Docker Web App Architecture: Phases 1, 11, 17, 34
- Database Architecture: Phases 2, 15, 17
- PostgreSQL Schema Plan: Phase 2
- First-Run Setup Wizard: Phases 4, 8, 9, 10, 11, 12
- Single-User Authentication And Fail2ban: Phases 4, 5
- Project Wizard: Phase 13
- Execution Limits: Phases 3, 17, 28
- Resource Limits And Watchdog: Phases 3, 17, 35, 37
- Git Versioning Policy: Phase 14
- Default Capability Setup: Phase 12
- Default MCP Servers: Phase 12
- Default Android Skills: Phase 12
- Default Review Agents: Phase 12
- Codex Documentation Indexing And Compatibility Review: Phases 9, 10
- Codex Implementation Gap Analysis: Phase 9
- Correct Codex Runner Design: Phases 18, 20
- Codex App-Server Schema Generation: Phases 9, 10, 18, 33, 35, 36
- Codex Config Schema Validation: Phases 9, 12, 33, 34, 35, 36
- Hook Design: Phase 19
- Managed Config/Hook Ownership: Phases 9, 12, 19, 33, 34, 35, 36
- Stop Hook Fallback Polling: Phases 17, 19, 35, 37
- MCP Configuration Rules: Phase 12
- AGENTS.md Guidance: Phase 31
- Web App Responsibilities: Phases 6, 7, 21, 32, 33
- Project Detail Screen: Phase 21
- Progress Overview: Phases 21, 27, 28
- Supervisor/Worker Timeline History: Phase 21
- Worker Latest Message: Phase 21
- User-Required Information Checklist: Phase 22
- Supervisor Direct Instruction Input: Phase 23
- Recent Run Artifacts: Phase 15, 21
- Project Download And Export: Phase 16
- Project Export Sensitivity And Audit: Phases 16, 29, 30, 35
- Web UI Navigation: Phases 6, 7
- Two-Session Model: Phases 18, 24, 25
- Supervisor Session: Phase 24
- Worker Session: Phase 25
- Supervisor Persona: Phase 24
- Supervisor Lifecycle: Phase 26
- Product Definition: Phase 26
- Market And Competitor Review: Phase 26
- Roadmap Planning And Audit: Phase 26
- Frontend And UX Planning: Phase 26
- Implementation Direction: Phases 24, 25, 26
- Roadmap-Code Gap Review: Phase 26
- QA Scenario Planning: Phase 26
- Emulator And Screenshot Verification: Phases 26, 27
- Code Review And Stabilization: Phase 26
- Production Readiness Judgment: Phase 28
- Terminal Email Notification: Phase 30
- Runtime Loop: Phases 17, 18, 19, 24, 28
- Backend Components: Phases 17 through 20, 24, 28, 30, 32
- Web Server: Phase 32
- Codex Runner: Phase 18
- Resource Monitor: Phase 17
- Worker Polling Watchdog: Phases 17, 19
- Project Exporter: Phase 16
- JSONL Parser: Phase 20
- Project State Analyzer: Phases 15, 17, 21, 24
- Verifier: Phase 27
- Next Action Planner: Phase 24
- Prompt Generator: Phase 24
- Completion Gate: Phase 28
- Sensitive File Policy: Phase 29
- Email Notifier: Phase 30
- MVP Scope: All phases
- Suggested File Structure: Phases 0, 1, 2, 32
- State Model: Phases 2, 21, 24, 27, 28
- Safety Requirements: Phases 4, 5, 9, 12, 17, 24, 29, 34
- MVP Success Criteria: Phase 37 validates the whole roadmap

## Implementation Order Summary

1. Scaffold, Compose, DB migrations.
2. Auth, settings, setup wizard.
3. Toolchain, Codex, docs, MCP/skills/agents.
4. Project wizard, project state, Git/versioning.
5. Artifact storage, project ZIP export.
6. Job runner, resource monitor, Codex runner, hooks, JSONL parser.
7. Dense dashboard, timeline, checklist, settings.
8. Supervisor prompt selection and worker task contracts.
9. Lifecycle prompt templates and verification tiers.
10. Completion gate, email, sensitive file policy.
11. Security hardening, docs, and stabilization.
