# App Factory Supervisor MVP

## Goal

Build a supervisor that can take responsibility for an app project from scratch to production readiness by repeatedly running Codex, inspecting the project state, deciding the next highest-value task, and launching the next Codex session automatically.

The supervisor stops only when one of these conditions is true:

- The app is production-ready after worker-run verification tasks produce sufficient evidence and the backend completion gate reaches terminal status.
- Only user-owned external actions remain, such as API keys, billing setup, OAuth approval, DNS, signing, or app store submission.
- The run fails after configured retry limits.
- A configured budget or safety limit is reached.

When the run stops, the supervisor emails the user with the final status and required next actions.

## Core Idea

The MVP is a Dockerized web app. Users create and monitor projects in the web UI, while the backend runs a supervisor loop for each project.

Each project uses two Codex-backed sessions:

- `supervisor` session: only decides the next prompt to send to the worker, including when to ask the worker to plan, review, verify, fix, or summarize.
- `worker` session: executes the concrete task selected by the supervisor, including planning, research, implementation, code review, verification, fixing, and reporting.

The application process orchestrates both sessions and persists all artifacts. Codex is executed in JSON mode so the web app can parse every event and display progress.

Every Codex session starts with `--yolo`. The worker receives one carefully scoped prompt. When the worker finishes, a hook notifies the supervisor. The backend records artifacts and summaries. The supervisor reads the worker's final response and backend summaries, then sends the next short prompt to the worker. Terminal status is set by the backend completion gate from worker-produced evidence and configured limits.

The supervisor must not write application code, directly modify project files, perform code review itself, run verification itself, or inspect the repository directly as a worker substitute. Its responsibility is prompt selection only. All planning, research, implementation, code review, verification, fixing, and reporting work is delegated to the worker.

## Project License

The supervisor web app is licensed under LGPL.

License rules:

- Use SPDX identifier `LGPL-3.0-or-later` by default.
- If the user later chooses a specific LGPL version, update all license metadata consistently.
- Add root license metadata before implementation starts.
- Generated Android app projects should record their own app license separately from the supervisor web app license.
- Dependency and bundled skill/agent reviews should flag licenses that conflict with LGPL distribution expectations.
- Release documentation should include LGPL obligations and third-party notices where required.

## Codex Invocation

Worker command:

```bash
codex exec \
  --json \
  --yolo \
  --dangerously-bypass-hook-trust \
  --output-schema "$WORKER_OUTPUT_SCHEMA" \
  --output-last-message "$WORKER_LAST_MESSAGE_PATH" \
  -C "$PROJECT_DIR" \
  "$NEXT_PROMPT"
```

Supervisor command:

```bash
codex exec \
  --json \
  --yolo \
  --dangerously-bypass-hook-trust \
  --output-schema "$SUPERVISOR_OUTPUT_SCHEMA" \
  --output-last-message "$SUPERVISOR_LAST_MESSAGE_PATH" \
  -C "$PROJECT_DIR" \
  "$SUPERVISOR_PROMPT"
```

Notes:

- `--json` makes Codex emit a JSON Lines event stream suitable for automation.
- `--output-schema` constrains the final response to a machine-readable JSON shape for downstream supervisor logic.
- `--output-last-message` writes the final assistant message to a separate artifact file so the backend does not need to reconstruct it from JSONL. PostgreSQL should store only the worker final response needed for the project timeline, not every final message from every session.
- Supervisor final responses and supervisor prompts sent to workers should be short, direct, and capped at 300 words.
- `--yolo` is the alias for bypassing approvals and sandboxing.
- `--dangerously-bypass-hook-trust` allows enabled hooks to run without interactive trust prompts.
- Because `--yolo` is dangerous, both sessions must run inside an externally isolated Docker container.

## Docker Web App Architecture

The MVP is delivered as a single Docker Compose deployment containing the supervisor web app, PostgreSQL, and enough bootstrap logic to install the required development toolchain on first run.

- web UI
- backend API
- PostgreSQL database
- job runner
- Codex CLI
- project workspace volume mount
- run artifact storage
- toolchain installer wizard

Suggested runtime:

```bash
docker compose up -d
```

The container must provide a controlled environment for `--yolo` execution. Project files should live under a mounted workspace such as `/app/projects/{projectId}`. Supervisor state, logs, and installed toolchain metadata should live under `/app/data`.

`--yolo` isolation rules:

- Treat Codex hooks as callbacks and guardrails, not as the primary security boundary.
- Run each worker turn as an internal process in the same app container for the MVP.
- Apply process-level safeguards for worker runs: dedicated working directory, explicit environment allowlist, resource checks before launch, timeout enforcement, sensitive path denylist, and artifact capture.
- The app database, app secrets, SMTP credentials, Codex auth files, and global keystore storage must not be mounted writable into the worker workspace.
- Worker sessions may write only to the project workspace and explicitly allowed build/cache directories.
- Supervisor sessions should run read-only against project source unless they are generating prompts or reports through backend-managed artifact writes.
- Sensitive path denial should be enforced by filesystem/container boundaries first, and by Codex hooks only as a secondary check.
- Network policy should be explicit. Required package/documentation/Git access may be allowed, but access to internal app services and secret stores should be blocked from worker sessions.

The Docker image should not pre-bundle every heavy Android and build dependency. Instead, the first web app launch should guide the user through a setup wizard that installs and verifies required tooling into a persistent mounted volume.

## Database Architecture

Use PostgreSQL as the primary application database.

Rationale:

- project state is relational
- supervisor/worker runs need durable status tracking
- timeline history needs queryable ordering
- progress gates, verification results, and checklist items need reliable updates
- JSONB is useful for flexible Codex event metadata and capability details
- advisory locks and transactions are useful for preventing duplicate worker runs
- PostgreSQL is a better fit than SQLite for roughly 100 projects and long-running automation

Storage split:

- PostgreSQL stores structured metadata, state, indexes, and audit records.
- Filesystem artifact storage stores large payloads such as JSONL logs, build logs, screenshots, APKs, AABs, generated reports, and attachments.
- PostgreSQL stores artifact path, hash, size, type, owner project, and retention metadata.
- PostgreSQL is the source of truth for run state. Filesystem artifacts are content-addressed or hash-verified evidence attached to that state.

Suggested services:

```text
app-factory-supervisor/
  app
  postgres
```

Suggested persistent data layout:

```text
data/
  postgres/
  projects/
  artifacts/
  runs/
  toolchains/
  capabilities/
  secrets/
```

Database rules:

- All project state transitions must be transactional.
- A project can have at most one active worker run.
- Use project-level locks before starting supervisor or worker runs.
- Use a persisted job table plus PostgreSQL locks so process crashes can be detected and recovered.
- Store raw Codex JSONL as files, not database rows.
- Do not store every Codex message in PostgreSQL.
- Store only the supervisor prompt sent to the worker and the worker's final response as queryable timeline records.
- Store parsed run summaries, verification summaries, and artifact references in PostgreSQL.
- Store secrets outside normal tables; ordinary tables should reference only secret ids or paths.
- Migrations must be versioned and run on app startup before the web app accepts traffic.
- State snapshots exposed to the UI are API DTOs or materialized views. The normalized PostgreSQL tables remain the durable source of truth.

Artifact retention rules:

- Store artifact size, hash, type, owning project, and retention class.
- Keep the latest release APK/AAB artifacts for terminal projects unless the user deletes the project.
- Compress old JSONL logs and build logs after terminal status or after a configurable number of days.
- Allow per-project artifact cleanup with a dry-run preview.
- Provide global retention settings for maximum artifact storage size and maximum retained run logs per project.
- Never delete artifacts referenced by final production-readiness, failure, or budget-exhaustion reports unless the user explicitly confirms.

Backup and restore rules:

- Back up PostgreSQL and filesystem artifacts together because database rows reference artifact paths and hashes.
- Provide an export manifest containing database dump timestamp, artifact root, artifact hashes, app version, and schema migration version.
- Restore must verify artifact hashes before marking a project usable.

## PostgreSQL Schema Plan

Initial tables:

```sql
create table users (
  id uuid primary key,
  admin_id text not null unique,
  password_hash text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table login_attempts (
  id uuid primary key,
  admin_id text,
  ip_address inet not null,
  user_agent text,
  success boolean not null,
  failure_reason text,
  created_at timestamptz not null
);

create table user_sessions (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  session_hash text not null unique,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null,
  last_seen_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create table banned_ips (
  id uuid primary key,
  ip_address inet not null unique,
  reason text not null,
  source text not null default 'fail2ban',
  banned_at timestamptz not null,
  expires_at timestamptz
);

create table app_settings (
  id boolean primary key default true,
  default_max_execution_hours integer not null default 24,
  default_max_worker_turns integer not null default 200,
  login_failures_before_ban integer not null default 3,
  min_free_memory_mb integer not null default 2048,
  min_available_memory_percent integer not null default 15,
  min_free_disk_mb integer not null default 10240,
  max_load_average numeric,
  max_cpu_usage_percent integer,
  memory_recheck_interval_seconds integer not null default 60,
  resource_recheck_interval_seconds integer not null default 60,
  codex_turn_timeout_seconds integer not null default 3600,
  build_timeout_seconds integer not null default 1800,
  test_timeout_seconds integer not null default 1800,
  mcp_tool_timeout_seconds integer not null default 120,
  export_timeout_seconds integer not null default 1800,
  emulator_timeout_seconds integer not null default 3600,
  stale_heartbeat_seconds integer not null default 180,
  worker_poll_interval_seconds integer not null default 300,
  email_notifications_enabled boolean not null default false,
  smtp_secret_id uuid,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint app_settings_singleton check (id)
);

create table projects (
  id uuid primary key,
  project_name text not null,
  app_name text not null,
  package_name text not null,
  user_app_plan text not null,
  project_type text not null check (project_type in ('new', 'existing')),
  platform text not null default 'android',
  language text not null default 'kotlin',
  repository_url text not null,
  project_dir text not null,
  status text not null,
  current_phase text not null,
  max_execution_hours integer not null default 24,
  max_worker_turns integer not null default 200,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table project_git_settings (
  project_id uuid primary key references projects(id) on delete cascade,
  global_user_name text not null,
  global_user_email text not null,
  ssh_public_key_path text not null,
  remote_reachable boolean not null default false,
  last_verified_at timestamptz
);

create table project_version_state (
  project_id uuid primary key references projects(id) on delete cascade,
  major integer not null default 0,
  minor integer not null default 1,
  patch integer not null default 0,
  run_suffix text not null,
  current_version text not null,
  last_commit_sha text,
  last_pushed_commit_sha text,
  updated_at timestamptz not null
);

create table toolchain_snapshots (
  id uuid primary key,
  snapshot_name text not null,
  android_platform_version text not null,
  android_build_tools_version text not null,
  android_cmdline_tools_version text,
  gradle_version text not null,
  jdk_version text not null,
  kotlin_version text,
  android_gradle_plugin_version text,
  emulator_image text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

create table project_toolchain_snapshots (
  project_id uuid primary key references projects(id) on delete cascade,
  toolchain_snapshot_id uuid not null references toolchain_snapshots(id),
  assigned_at timestamptz not null
);

create table runs (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  role text not null check (role in ('supervisor', 'worker')),
  iteration integer not null,
  status text not null,
  codex_thread_id text,
  prompt_artifact_id uuid,
  jsonl_artifact_id uuid,
  worker_final_response text,
  worker_final_response_artifact_id uuid,
  exit_code integer,
  started_at timestamptz not null,
  finished_at timestamptz
);

create table jobs (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  run_id uuid references runs(id) on delete set null,
  job_type text not null check (job_type in ('supervisor_turn', 'worker_turn', 'verification', 'setup', 'notification', 'project_export')),
  status text not null check (status in ('queued', 'waiting_resources', 'running', 'succeeded', 'failed', 'cancelled', 'stale')),
  priority integer not null default 0,
  attempts integer not null default 0,
  max_attempts integer not null default 1,
  locked_by text,
  locked_at timestamptz,
  heartbeat_at timestamptz,
  timeout_at timestamptz,
  stale_after timestamptz,
  resource_wait_reason text,
  scheduled_at timestamptz not null,
  started_at timestamptz,
  finished_at timestamptz,
  error_summary text,
  metadata jsonb not null default '{}'::jsonb
);

create table resource_checks (
  id uuid primary key,
  job_id uuid references jobs(id) on delete set null,
  check_type text not null check (check_type in ('memory', 'disk', 'cpu', 'load')),
  status text not null check (status in ('pass', 'wait', 'fail')),
  available_memory_mb integer,
  free_memory_mb integer,
  total_memory_mb integer,
  required_free_memory_mb integer,
  required_available_memory_percent integer,
  free_disk_mb integer,
  required_free_disk_mb integer,
  cpu_usage_percent integer,
  max_cpu_usage_percent integer,
  load_average numeric,
  max_load_average numeric,
  checked_at timestamptz not null,
  next_check_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table project_locks (
  project_id uuid primary key references projects(id) on delete cascade,
  lock_owner text not null,
  lock_reason text not null,
  locked_at timestamptz not null,
  expires_at timestamptz
);

create table process_heartbeats (
  id uuid primary key,
  job_id uuid references jobs(id) on delete cascade,
  run_id uuid references runs(id) on delete cascade,
  process_kind text not null,
  pid integer,
  host_id text,
  status text not null,
  last_seen_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb
);

create table timeline_events (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  run_id uuid references runs(id) on delete set null,
  iteration integer not null,
  event_type text not null check (event_type in ('supervisor_prompt_sent', 'worker_final_response')),
  title text not null,
  body text,
  body_artifact_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

create table progress_gates (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  gate_key text not null,
  label text not null,
  phase text not null,
  status text not null check (status in ('pending', 'pass', 'fail', 'blocked', 'skipped')),
  weight integer not null default 1,
  evidence_artifact_id uuid,
  updated_at timestamptz not null,
  unique (project_id, gate_key)
);

create table user_required_items (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  item_key text not null,
  label text not null,
  status text not null check (status in ('needed', 'provided', 'pass', 'failed', 'blocked')),
  required_for_production boolean not null default true,
  can_continue_without_it boolean not null default false,
  secret boolean not null default false,
  secret_id uuid,
  last_validation text,
  updated_at timestamptz not null,
  unique (project_id, item_key)
);

create table verification_results (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  run_id uuid references runs(id) on delete set null,
  check_type text not null,
  status text not null check (status in ('pass', 'fail', 'skipped')),
  command text,
  summary text,
  artifact_id uuid,
  created_at timestamptz not null
);

create table artifacts (
  id uuid primary key,
  project_id uuid references projects(id) on delete cascade,
  run_id uuid references runs(id) on delete set null,
  artifact_type text not null,
  path text not null,
  sha256 text,
  size_bytes bigint,
  redacted boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

create table project_exports (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  requested_by_user_id uuid references users(id) on delete set null,
  status text not null check (status in ('queued', 'running', 'ready', 'failed', 'expired', 'deleted')),
  export_type text not null check (export_type in ('full_project_archive')),
  include_ignored_files boolean not null default true,
  include_keystores boolean not null default true,
  artifact_id uuid references artifacts(id) on delete set null,
  file_count integer,
  size_bytes bigint,
  sha256 text,
  error_summary text,
  requested_at timestamptz not null,
  started_at timestamptz,
  finished_at timestamptz,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table market_research (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  source_type text not null,
  source_url text,
  title text,
  summary text not null,
  evidence_artifact_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

create table deferred_features (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  feature_name text not null,
  reason text not null,
  estimated_cost text,
  expected_user_value text,
  reconsider_when text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table capability_installations (
  id uuid primary key,
  capability_type text not null check (capability_type in ('mcp', 'skill', 'agent')),
  capability_id text not null,
  source_type text not null,
  source text,
  revision text,
  version text,
  wired_to text[] not null,
  status text not null,
  metadata jsonb not null default '{}'::jsonb,
  last_verified_at timestamptz,
  unique (capability_type, capability_id)
);

create table codex_doc_indexes (
  id uuid primary key,
  index_name text not null unique,
  store_path text not null,
  document_count integer not null default 0,
  unique_url_count integer not null default 0,
  codex_cli_version text,
  indexed_at timestamptz,
  status text not null,
  metadata jsonb not null default '{}'::jsonb
);

create table codex_compatibility_reviews (
  id uuid primary key,
  codex_doc_index_id uuid references codex_doc_indexes(id) on delete set null,
  codex_cli_version text not null,
  json_mode_supported boolean not null,
  output_schema_supported boolean not null,
  output_last_message_supported boolean not null,
  exec_resume_supported boolean not null,
  hooks_supported boolean not null,
  mcp_required_supported boolean not null,
  gap_summary text not null,
  artifact_id uuid,
  created_at timestamptz not null
);

create table secrets (
  id uuid primary key,
  secret_type text not null,
  storage_path text not null,
  description text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table notifications (
  id uuid primary key,
  project_id uuid references projects(id) on delete cascade,
  notification_type text not null,
  recipient text not null,
  status text not null,
  subject text not null,
  body_artifact_id uuid,
  sent_at timestamptz,
  created_at timestamptz not null
);

alter table app_settings
  add constraint fk_app_settings_smtp_secret
  foreign key (smtp_secret_id) references secrets(id) on delete set null;

alter table runs
  add constraint fk_runs_prompt_artifact
  foreign key (prompt_artifact_id) references artifacts(id) on delete set null,
  add constraint fk_runs_jsonl_artifact
  foreign key (jsonl_artifact_id) references artifacts(id) on delete set null,
  add constraint fk_runs_worker_final_response_artifact
  foreign key (worker_final_response_artifact_id) references artifacts(id) on delete set null;

alter table timeline_events
  add constraint fk_timeline_events_body_artifact
  foreign key (body_artifact_id) references artifacts(id) on delete set null;

alter table progress_gates
  add constraint fk_progress_gates_evidence_artifact
  foreign key (evidence_artifact_id) references artifacts(id) on delete set null;

alter table user_required_items
  add constraint fk_user_required_items_secret
  foreign key (secret_id) references secrets(id) on delete set null;

alter table verification_results
  add constraint fk_verification_results_artifact
  foreign key (artifact_id) references artifacts(id) on delete set null;

alter table market_research
  add constraint fk_market_research_evidence_artifact
  foreign key (evidence_artifact_id) references artifacts(id) on delete set null;

alter table codex_compatibility_reviews
  add constraint fk_codex_compatibility_reviews_artifact
  foreign key (artifact_id) references artifacts(id) on delete set null;

alter table notifications
  add constraint fk_notifications_body_artifact
  foreign key (body_artifact_id) references artifacts(id) on delete set null;
```

Suggested indexes:

```sql
create index idx_projects_status on projects(status);
create index idx_runs_project_iteration on runs(project_id, iteration);
create index idx_runs_status on runs(status);
create index idx_jobs_project_status on jobs(project_id, status, scheduled_at);
create index idx_jobs_heartbeat on jobs(status, heartbeat_at);
create index idx_resource_checks_job_checked on resource_checks(job_id, checked_at);
create index idx_user_sessions_user_expires on user_sessions(user_id, expires_at);
create index idx_timeline_project_created on timeline_events(project_id, created_at);
create index idx_artifacts_project_type on artifacts(project_id, artifact_type);
create index idx_project_exports_project_status on project_exports(project_id, status, requested_at);
create index idx_verification_project_created on verification_results(project_id, created_at);
create index idx_market_research_project_source on market_research(project_id, source_type);
create index idx_progress_gates_project_status on progress_gates(project_id, status);
```

## First-Run Setup Wizard

On first launch, the web app should detect whether the development environment is ready. If required tools are missing, it should block project execution and show a setup wizard.

Global wizard order:

1. Set admin id and password.
2. Install the deployment/build environment.
3. Show the generated SSH public key and explain how to register it in Git hosting.

The global wizard should:

- detect host/container OS and CPU architecture
- choose install locations under a persistent volume
- configure and verify Codex authentication before any project automation starts
- install Android development tooling
- install general development tooling
- install app build tooling
- generate or reuse an SSH key pair for Git access
- show the SSH public key to the user
- explain the basic Git hosting registration path for the SSH public key
- configure environment variables
- verify all required commands
- run a minimal non-destructive Codex dry run to prove authentication and JSONL execution work
- save installed versions and verification results
- allow retrying failed setup steps

Required Android tooling:

- Android SDK command-line tools
- Android platform tools
- Android build tools
- latest stable Android platform package
- Android emulator
- AVD system image
- AVD creation and launch support
- Gradle latest stable version, resolved at install time
- Java/JDK version compatible with current Android Gradle Plugin requirements

Required general tooling:

- Git
- Node.js and package manager support
- Python 3
- Playwright browser dependencies and at least Chromium for web/UI smoke tests
- image processing tools
- Base64 tooling
- archive tools
- shell utilities used by common build scripts
- keystore creation/signing tools

Required account setup:

- The wizard must ask for an admin id.
- The wizard must ask for an admin password.
- The admin password must be stored only as a password hash.
- The wizard should require password confirmation.
- If account setup is incomplete, the web app should show only the setup wizard.

Required Codex setup:

- The wizard must verify `codex --version`.
- The wizard must verify Codex authentication is usable in the container runtime.
- The wizard must run a short `codex exec --json` smoke test in a temporary empty directory.
- The wizard must fail Build Environment readiness when Codex auth is missing, expired, or unable to run non-interactively.
- Codex auth files and tokens must be stored outside project workspaces and must not be mounted into worker containers unless strictly required and read-only.
- Codex auth status should be visible in Settings without exposing tokens or account secrets.

## Single-User Authentication And Fail2ban

The web app is planned as a single-user application.

Authentication rules:

- exactly one admin account is required for MVP
- no multi-user roles are required
- no public signup is allowed
- password change is available from Settings
- login attempts should be recorded with timestamp, IP address, user agent, success/failure, and failure reason

Fail2ban policy:

- Use fail2ban to block IP addresses after 3 failed password attempts.
- The application should write authentication failure logs in a stable parseable format.
- The fail2ban jail should watch the web app authentication log.
- The default failure threshold is 3.
- The ban action should block the offending IP at the host or container network boundary.
- The preferred deployment model is host-level fail2ban reading a bind-mounted authentication log from the container.
- Container-internal fail2ban should be treated as an advanced option because it may require additional Linux capabilities or host firewall access.
- The app should also store login attempts in PostgreSQL for audit visibility.
- The UI should show recent failed login attempts in Settings.
- The UI should show currently banned IPs when available.

Suggested auth failure log line:

```text
AUTH_FAIL ip=<ip> admin_id=<admin_id> reason=<reason>
```

Suggested fail2ban filter pattern:

```text
^.*AUTH_FAIL ip=<HOST> .*$ 
```

Operational notes:

- If the app runs behind a reverse proxy, trusted forwarded IP configuration must be correct before enabling fail2ban.
- If trusted proxy configuration is wrong, fail2ban may ban the proxy instead of the real client.
- The first-run wizard should warn the user when the app is externally exposed without trusted proxy/IP configuration.
- The wizard should show whether fail2ban is active, which log path it watches, and whether bans are enforced by the host or by a container network boundary.

Required SSH key setup:

- The wizard must create an SSH key pair when one does not already exist.
- The wizard must never overwrite an existing SSH key pair automatically.
- The wizard must show the SSH public key.
- The wizard must briefly explain how to add the public key to Git hosting.
- The wizard should include generic instructions for GitHub, GitLab, Gitea, and other SSH-capable Git hosts.
- The SSH private key must never be shown in the UI, prompts, JSONL logs, or emails.

Required verification:

- `codex --version`
- `git --version`
- SSH public key exists
- `node --version`
- `python3 --version`
- `java -version`
- `gradle --version`
- `sdkmanager --list`
- `adb version`
- emulator availability
- AVD creation check
- Android debug keystore check

Version policy:

- Resolve current latest stable versions during setup instead of hardcoding them in the Docker image.
- Persist the selected versions for reproducibility.
- Create a toolchain snapshot after successful setup.
- Assign a fixed toolchain snapshot to each project at project creation time.
- Allow the user to rerun the wizard to upgrade tools later.
- Never upgrade an active project's toolchain in the middle of a supervisor run.
- New projects may use the newly upgraded toolchain snapshot only after the upgrade verification passes.
- Existing projects should continue using their assigned toolchain snapshot unless the user explicitly requests a project toolchain upgrade.

Keystore policy:

- The global wizard may create a debug keystore automatically.
- Project release keystore handling belongs to the project wizard.
- Generated keystores and passwords must not be written into Codex prompts or JSONL logs.
- If production signing is required before automation can continue and no release keystore is configured, the supervisor should stop as `BLOCKED_NEEDS_USER`.

## Project Wizard

Each project should start with a project-specific wizard before supervisor/worker sessions are allowed.

Project wizard order:

1. Enter project name, app name, and package name.
2. Enter a short free-form plan describing what app the user wants to build.
3. Choose `new project` or `existing project`.
4. For a new project, enter an empty Git repository URL.
5. For an existing project, enter the existing Git repository URL.
6. For a new project, create a release keystore.
7. For an existing project, mark release keystore as upload-later unless the user provides it immediately.

Required project fields:

- project name
- app name
- Android package name
- user app plan
- project type: `new | existing`
- Git repository URL
- global Git `user.name`
- global Git `user.email`
- max execution hours
- max worker turns

Project defaults:

- Platform is fixed to Android only.
- Language is fixed to Kotlin.
- Default max execution time is 24 hours.
- Default max worker turns is 200.
- The user may override max execution time and max worker turns per project.
- Settings should allow the user to define default values used for newly created projects.

Git project setup:

- The project wizard must ask for global Git `user.name`.
- The project wizard must ask for global Git `user.email`.
- The project wizard must run `git config --global user.name "<value>"` inside the persistent runtime user environment.
- The project wizard must run `git config --global user.email "<value>"` inside the persistent runtime user environment.
- The wizard should verify the repository URL is reachable after the user registers the SSH public key.
- If the repository cannot be reached because SSH access is missing, the project should be marked `BLOCKED_NEEDS_USER` until the user registers the public key or provides access.
- Git identity values are not secrets, but they should still be shown back to the user for confirmation before writing global config.

New project flow:

- The user provides an empty repository URL.
- The user provides a short text description of the app they want to build.
- The supervisor should treat the repository as the target remote for the new app.
- The project wizard creates a release keystore during setup.
- The release keystore should be stored in the persistent keystore directory.
- Keystore passwords must be stored only through the app's secret storage.
- The worker should initialize the repository only after the supervisor creates the first scoped prompt.
- The first project work should be MVP and roadmap documentation.
- The supervisor should pass the user's app plan into the first MVP-writing worker prompt so it can guide product direction.
- The supervisor should ask the worker to create project planning artifacts before implementation begins.
- Initial planning artifacts should include at minimum `mvp.md` and `roadmap.md`.
- Implementation should begin only after the worker reports that planning artifacts are ready and the supervisor sends the first implementation prompt.

Existing project flow:

- The user provides an existing repository URL.
- The worker should clone and inspect the existing project.
- The project wizard should not force release keystore upload immediately.
- Release keystore status starts as `upload_later`.
- When release signing is required before automation can continue, the supervisor should prompt for upload or final summary evidence; the backend completion gate marks `BLOCKED_NEEDS_USER` if no keystore is available.
- After clone, the supervisor should ask the worker to inspect current roadmap/planning documents, code implementation state, build configuration, and verification status.
- The worker should report whether existing roadmap artifacts are missing, stale, partial, or usable.
- The worker should report current implementation completion level before the supervisor assigns new implementation work.
- If no usable roadmap exists, the supervisor should first ask the worker to create or reconstruct `mvp.md` and `roadmap.md` from the existing code and user goal.
- If a usable roadmap exists, the supervisor should continue from the highest-priority incomplete or failing item.
- The supervisor should not restart the project from scratch unless the user explicitly requests it.

## Execution Limits

Each project should have configurable execution limits.

Defaults:

- max execution time: 24 hours
- max worker turns: 200

Rules:

- The user can set project-specific max execution hours.
- The user can set project-specific max worker turns.
- Settings can define defaults for newly created projects.
- The supervisor should stop before starting a new worker turn if the max execution time has already been reached.
- If a worker prompt was already sent before the time limit, that worker turn should be allowed to finish.
- The same rule applies when the time limit is reached shortly before completion: the active worker task finishes, then supervisor stops or reports current state.
- When the max worker turn limit is reached, the supervisor should stop after the active worker turn and report the remaining work.
- Time and turn limit stops should send the final email with current progress, last completed phase, unresolved blockers, and suggested next action.

## Git Versioning Policy

The system should automatically version and commit work for every completed unit of work.

Version format:

- semantic version: `major.minor.patch`
- build/run suffix: `yymmddrrr`

Example:

```text
1.4.12+260809003
```

Rules:

- A unit of work means one scoped worker task, roadmap item, bug fix, review fix batch, documentation update, setup change, or verification artifact update.
- Every completed unit of work should produce an automatic commit when there are file changes.
- A worker turn may contain one or more unit-of-work commits when the worker completes multiple clearly separable units.
- If a worker turn changes files but the task is not completed, commit only when the partial state is useful, buildable where applicable, and clearly marked in the commit message.
- The commit should include the current version identifier.
- Patch should normally increment per completed unit-of-work commit.
- Minor should increment after meaningful feature or phase completion.
- Major should increment only for explicit major product milestones or breaking project direction changes.
- `yymmddrrr` should use the current date and a same-day rolling run number.
- If a worker turn fails with no useful file changes, the backend should not force a commit.
- If a worker turn produces bad changes, the supervisor should record the failed turn and either ask the worker to fix forward or revert through a scoped worker prompt.
- The supervisor itself must not edit files to create commits; commit commands should be issued by the worker or by backend automation according to the versioning policy.
- Commit messages should identify the unit type, scope, version, and verification level when available.

Push policy:

- Commit locally after every worker turn with changes.
- Push only after phase-level completion or another explicitly configured large boundary.
- Push after planning phase completion.
- Push after roadmap audit phase completion.
- Push after implementation phase milestones.
- Push after QA/stabilization milestones.
- Push when the project reaches terminal status.
- A phase-ending push should include all unit-of-work commits completed in that phase.
- If push fails, keep local commits, mark the project as needing Git user action or retry according to error type, and show the failure in the project UI.
- Do not push credential files or ignored sensitive directories.

## Default Capability Setup

The first-run setup wizard should also install and configure the default Android development capabilities used by Codex supervisor and worker sessions.

The default set must not include App Factory Autopilot components or Sequential Thinking:

- Do not install `app-factory-core`.
- Do not install `app-factory-*` skills by default.
- Do not install `@modelcontextprotocol/server-sequential-thinking`.
- Do not rely on App Factory Autopilot state machines for this product's core loop.

Reason: this product owns the supervisor loop. Planning, review, verification, state transitions, and final completion evidence must be implemented through this app's worker prompts and backend completion gate, not delegated to the existing App Factory plugin.

Capability installation has three sources:

- MCP servers: never bundled as ready-to-use runtime state; install and register them during the first-run wizard.
- Built-in skills and agents: skills/agents authored for this product may be bundled in the Docker image as static assets.
- External skills and agents: skills/agents available from public or configured repositories should be downloaded, verified, installed, and wired during the first-run wizard.

The image may include installer manifests, pinned source URLs, checksums, and built-in skill/agent files. The wizard performs the actual user-scope wiring into Codex config, skill directories, and agent directories.

### Default MCP Servers

Install all default MCP servers during the first-run wizard:

- `mobile-docs`: version-aware Android/Kotlin/Gradle/Flutter documentation search.
- `context7`: current library and framework documentation lookup.
- `mobile-mcp`: Android emulator or device interaction, screenshots, accessibility tree inspection, and manual-flow verification.
- `playwright`: browser automation for the supervisor web app and web-based debug views.
- `memory`: long-running project notes and durable context.
- `time`: timezone and timestamp support.

Optional credentialed MCP servers:

- `github`: repository, issue, pull request, and release workflows.
- `play-store-mcp`: Google Play Console actions that require credentials.
- `app-publish`: app publishing workflows that require service account credentials.
- `firebase`: Firebase project access.
- `sentry`: crash and issue lookup.

Optional advanced MCP servers:

- `code-review-graph`: repeated review finding tracking.
- database MCP servers such as SQLite, PostgreSQL, Redis, or MongoDB.
- fetch/search MCP servers when web lookup is needed beyond built-in capabilities.

MCP wizard requirements:

- install required npm or binary packages into a persistent tool volume
- write MCP entries into the Codex config used by both supervisor and worker sessions
- verify that each MCP server can start
- redact secrets from logs and status output
- keep credentialed MCP servers disabled until required credentials are supplied
- record package name, installed version, install source, and verification result

### Default Android Skills

Built-in Android implementation skills may be bundled in the Docker image and wired into Codex during the first-run wizard.

Worker implementation skills:

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

Worker review skills may be bundled only when they do not depend on App Factory Autopilot internals:

- `project-explore`
- `dependency-version-review`
- `placeholder-audit`
- `completion-verify`
- `final-gate`
- `license-compliance-review`
- `license-report`
- `qa-scenario-writer`

Any existing App Factory skill with `factory-*`, `roadmap-*`, or `app-factory-*` naming should be treated as reference material only, not as a default installed capability.

Skill wizard requirements:

- copy bundled skills from the image into the persistent Codex skills directory
- download external skills from configured repositories when they are not bundled
- verify each `SKILL.md` has valid frontmatter
- preserve user-edited skills unless the user explicitly chooses overwrite
- record source type: `bundled | repository | user`
- record source URL and revision for repository-installed skills
- make worker-only skills unavailable to the supervisor when enforcing supervisor no-code rules
- make review skills available to the worker; the supervisor may only prompt the worker to use them

### Default Review Agents

Built-in review agents authored for this product may be bundled in the Docker image. Repository-available agents should be downloaded by the wizard.

Install review agents as worker-invoked evaluation perspectives, not as independent implementers:

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

These agents should feed worker review reports and supervisor next-prompt generation. They must not directly edit project files.

Agent wizard requirements:

- copy bundled agents from the image into the persistent agent directory
- download external agents from configured repositories when they are not bundled
- validate agent metadata and role restrictions
- record source type: `bundled | repository | user`
- record source URL and revision for repository-installed agents
- enforce read-only/review-only behavior for supervisor agents
- prevent review agents from mutating project files directly

## Codex Documentation Indexing And Compatibility Review

The setup wizard should use `mobile-docs` to index the current official Codex documentation before project automation starts.

Purpose:

- keep Codex CLI usage grounded in current official behavior
- collect JSON mode, output schema, hooks, MCP, security, SDK, app-server, skills, plugins, and changelog guidance
- detect breaking changes or deprecated flags that affect the supervisor runner
- provide source-backed snippets for generated worker and supervisor prompts
- reduce reliance on stale remembered Codex behavior

Required indexed documentation set:

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
- `config.toml` reference
- security, sandbox, approvals, and network policy
- skills and plugins
- Codex SDK
- Codex app-server
- developer commands
- changelog and breaking changes
- best practices and `AGENTS.md`

Suggested `mobile-docs` commands:

```bash
DOCS_MCP_STORE_PATH=/data/mobile-docs \
docs-mcp-server scrape openai-codex https://developers.openai.com/codex/non-interactive-mode \
  --scrape-mode fetch --max-pages 1 --clean false --quiet

DOCS_MCP_STORE_PATH=/data/mobile-docs \
docs-mcp-server search openai-codex "codex exec --json output-schema hooks MCP" \
  --output json --quiet
```

The wizard should save:

- indexed URL list
- document count
- indexing timestamp
- search smoke-test results
- known Codex CLI version
- gap analysis report
- generated app-server TypeScript schema path
- generated app-server JSON Schema path
- generated `config.toml` schema validation result
- managed config/hook ownership report

Suggested artifact:

```text
docs/codex-compatibility-review.md
```

### Codex Implementation Gap Analysis

The supervisor app should perform a Codex compatibility review during setup and after Codex CLI upgrades.

Checks:

- installed `codex --version`
- `codex exec --help` includes `--json`
- `codex exec --help` includes `--output-schema`
- `codex exec --help` includes `--output-last-message`
- `codex exec --help` includes `resume`
- `codex app-server generate-ts` can generate version-matched TypeScript schemas
- `codex app-server generate-json-schema` can generate version-matched JSON schemas
- generated Codex app-server schemas are saved as artifacts
- generated Codex `config.toml` passes schema validation
- `codex mcp list` includes required MCP servers
- `mobile-docs` MCP can start
- `mobile-docs` contains the `openai-codex` index
- hook config can be loaded
- Stop hook callback reaches backend
- JSONL parser recognizes current event names

If a gap is detected, setup should fail or mark the Build Environment as not ready.

Schema generation and validation:

- During setup and after Codex CLI upgrades, generate app-server schemas for the installed Codex version.
- Suggested commands:

```bash
codex app-server generate-ts --out /app/data/codex-schemas/current
codex app-server generate-json-schema --out /app/data/codex-schemas/current
```

- Store generated schemas as artifacts and record their Codex CLI version.
- Use generated schemas as compatibility evidence, not as the primary MVP runtime.
- Validate generated Codex `config.toml` against the official/current config schema before enabling automation.
- If schema generation or config validation fails, mark Build Environment not ready.

### Correct Codex Runner Design

Use `codex exec --json` as the primary MVP execution path.

Required runner behavior:

- pass prompts through stdin or a prompt file when they become large
- always capture JSONL stdout to an artifact
- always capture stderr to an artifact
- always write `--output-last-message` to a dedicated artifact
- always use `--output-schema` for supervisor and worker final reports
- parse JSONL event types including `thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.*`, and `error`
- persist token usage from `turn.completed` when available
- treat JSONL item schemas as version-sensitive and tolerant to unknown fields
- do not rely on transcript file format as a stable API
- treat `codex exec resume` as optional recovery support, not the main loop

The first MVP should not use Codex SDK or app-server as the primary orchestration layer. They are useful future alternatives, but the CLI JSONL path is simpler and already supports the required automation primitives.

Future upgrade path:

- evaluate `@openai/codex-sdk` if thread continuation needs tighter server-side control
- evaluate `codex app-server` if the app needs live thread subscriptions, thread listing, or richer JSON-RPC integration
- keep the CLI runner abstraction thin so the backend can swap from CLI to SDK/app-server later

### Hook Design

Hooks are useful guardrails and callbacks, but they are not the only source of truth.

Managed config and hook ownership:

- The app should generate Codex config and hooks into clearly marked app-managed files or sections.
- App-managed hook/config content should include owner, generated timestamp, app version, and Codex CLI version metadata.
- User-edited hook/config files should not be silently overwritten.
- If user edits conflict with app-managed config or hooks, setup should show a conflict and require user confirmation or regeneration.
- Managed hooks/config should be distinguishable from user hooks/config in the UI.
- The compatibility review should include a managed hook/config ownership report.

Use hooks for:

- notifying backend when a turn stops
- enforcing supervisor no-code rules
- blocking accidental secret exposure
- blocking writes to ignored sensitive paths
- adding setup context on session start

Stop hook behavior:

- Stop hook receives the latest assistant message when available.
- Stop hook output must be JSON when it exits successfully.
- Stop hook can ask Codex to continue by returning a blocking decision with a reason.
- The supervisor app should not rely on Stop hook continuation for the main loop.
- The backend should decide whether to start the next worker turn after independent verification.

SessionEnd behavior:

- SessionEnd is advisory.
- It can be used for cleanup and final note collection.
- It should not be used to steer Codex or keep a thread open.

### MCP Configuration Rules

Codex MCP configuration should be generated by the setup wizard.

Rules:

- write MCP config to the Codex `config.toml` used inside the app container
- validate generated `config.toml` against the Codex config schema before enabling automation
- keep app-managed config sections clearly marked and avoid silently overwriting user-managed sections
- set `required = true` for required MCP servers when startup should fail without them
- set `startup_timeout_sec` when a server commonly needs longer than the default startup window
- set `tool_timeout_sec` for slow documentation or emulator tools
- set `enabled_tools` or `disabled_tools` where a server exposes tools that should not be available
- store MCP package/version/source metadata in PostgreSQL
- verify each MCP server using `codex mcp list` and a lightweight functional smoke test

Example generated config:

```toml
[mcp_servers.mobile-docs]
command = "docs-mcp-server"
args = ["--protocol", "stdio"]
required = true
startup_timeout_sec = 30
tool_timeout_sec = 120

[mcp_servers.mobile-docs.env]
DOCS_MCP_STORE_PATH = "/data/mobile-docs"
```

### AGENTS.md Guidance

Each generated or imported project should have an `AGENTS.md`.

It should include:

- Android/Kotlin-only scope
- build, lint, test, and emulator commands
- project architecture rules
- supervisor/worker boundaries
- no-secret rules
- `keystores/` ignore requirement
- done criteria
- verification commands
- commit/versioning rules
- automatic commit after every completed unit of work
- push after each phase completion

The supervisor should ask the worker to update `AGENTS.md` only through a scoped worker prompt.

## Web App Responsibilities

The web app provides:

- project creation
- project goal input
- run start/stop controls
- current status view
- latest supervisor decision
- supervisor/worker timeline history
- latest worker message
- direct supervisor instruction input
- user-required information checklist and pass status
- production-readiness progress bar
- build/test/verification status
- toolchain setup status
- artifact links
- terminal status and email notification state
- configurable default max execution hours and max worker turns
- password change
- fail2ban records tab

The UI should not be a marketing page. The first screen should be the project dashboard.

The MVP does not need an interactive terminal console. Users should not send raw shell commands through the web UI.

## Project Detail Screen

Each project screen should focus on prompt-driven progress, not terminal interaction.

Required project detail sections:

- progress overview
- supervisor/worker timeline history
- worker latest message
- current supervisor decision
- verification status
- user-required information checklist
- direct instruction input for the supervisor
- recent run artifacts
- project download/export
- final status summary

### Progress Overview

Show a production-readiness progress bar.

The percentage should be derived from backend-managed progress gates, not elapsed time. Example gates:

- requirements clarified
- MVP drafted
- market and competitor review completed
- MVP revised after competitor review
- roadmap drafted
- roadmap audit passes completed
- deferred items recorded with rationale
- frontend and UX plan completed
- phone/foldable/tablet layout plan completed
- project scaffold ready
- core features implemented
- UI states implemented
- persistence/networking implemented when required
- roadmap-code gap review completed
- Android build passes
- tests pass
- QA scenario plan completed
- emulator or device scenario tests pass
- screenshot review passes
- phone/foldable/tablet verification passes where applicable
- full-code review passes
- release-blocking placeholders cleared
- permissions/privacy reviewed
- signing/release packaging reviewed
- documentation/runbook ready
- external user actions resolved or explicitly blocked

Progress gate policy:

- Do not advance major gates from the worker final response alone.
- Minor internal progress may update after `T0` or `T1` verification when the change is low-risk and isolated.
- Feature completion gates should normally require `T1` or `T2` evidence.
- Phase completion gates should normally require `T2`.
- Roadmap and implementation progress gates must not run emulator/device verification.
- Terminal readiness gates must require `T4`.
- The UI should show the latest verification tier used for the current progress state.

The screen should also show:

- current iteration number
- current phase
- last worker run result
- last verification time
- next planned action
- estimated blocker type, when blocked

### Supervisor/Worker Timeline History

Show the work history as an alternating timeline so the user can understand how the project is progressing.

The timeline is intentionally not a full transcript. PostgreSQL should store only:

- the supervisor prompt sent to the worker
- the worker's final response
- metadata needed to link the prompt/response pair to run artifacts and verification results

The timeline should preserve this sequence:

1. supervisor prompt sent to worker
2. worker final message
3. next supervisor prompt sent to worker
4. next worker final message
5. repeat until terminal status

Each supervisor prompt item should include:

- iteration number
- timestamp
- prompt title or task summary
- full prompt body expandable on demand
- worker run id
- result after the matching worker run: `completed | failed | retrying | superseded`
- linked artifacts and verification results

Each worker message item should include:

- iteration number
- timestamp
- worker run id
- final worker response
- exit status
- verification summary
- linked JSONL log and build/test artifacts

The project screen may still show the latest worker message as a compact status summary, but the main history should be the alternating supervisor/worker timeline.

### Worker Latest Message

Show the worker's latest final response in the project screen.

This is for operator visibility only. The supervisor must still rely on backend summaries and worker-produced evidence before choosing the next prompt.

The worker's final response is a claim, not proof. It must never be the sole basis for progress percentage, terminal status, blocker classification, or the next worker prompt.

### User-Required Information Checklist

Show a checklist of information or external actions the user must provide.

Examples:

- app name
- package name
- target audience
- required permissions
- privacy policy URL
- API keys
- OAuth client setup
- AdMob app id or ad unit ids
- Play Console service account
- production signing key
- DNS/domain setup
- legal or policy approval

Each item should show:

- status: `needed | provided | pass | failed | blocked`
- whether it is required for production
- whether the supervisor can continue without it
- last validation result
- safe input method or upload control when applicable

Sensitive values must be stored as secrets and never included in Codex prompts, JSONL logs, or email bodies.

### Supervisor Direct Instruction Input

Each project screen should provide a prompt input for the user to directly instruct the supervisor.

This input is not sent directly to the worker. The supervisor must:

- read the user instruction
- compare it with backend-provided current project state
- decide whether it changes the plan
- generate a scoped worker prompt if implementation is needed
- record the instruction in project history

The input should support:

- plain text instruction
- optional file attachment reference
- priority marker
- "apply after current worker run" behavior when a worker is already running

### Recent Run Artifacts

Show links to recent artifacts:

- supervisor prompts
- worker JSONL logs
- final worker responses
- verification reports
- build logs
- APK/AAB artifacts
- screenshots
- review summaries

Artifacts should be readable from the UI without exposing secrets.

### Project Download And Export

Each project screen should allow the user to download the project at any time.

Download rules:

- Provide a `Download Project` action.
- The action creates a compressed archive of the entire project folder.
- The archive format is ZIP.
- The archive must include gitignored project files when they are inside the project folder.
- The archive must include `keystores/` and signing-related files when present.
- The archive should preserve relative paths and file permissions where practical.
- The archive should not include app-global secrets, Codex authentication files, PostgreSQL data, or other projects unless those files are physically inside the selected project folder.
- The archive should be generated by backend automation, not by the supervisor or worker.
- The archive generation job must obey memory pressure checks before starting.
- The UI should show export status: `queued | running | ready | failed | expired | deleted`.
- The UI should show archive size, file count, checksum, created time, and expiration time.
- The user should be able to download the latest ready archive or request a fresh archive.

Security notes:

- Because project exports may include keystores and signing material, the UI should clearly mark full-project archives as sensitive.
- Download URLs should be authenticated, short-lived, and scoped to the single admin session.
- Export creation and download should be recorded in audit logs.
- Export artifacts should not be sent by email.
- Export artifacts should expire automatically unless the user explicitly keeps or regenerates them.

## Web UI Navigation

The web app should use a persistent left sidebar.

Primary sidebar menu items:

- Projects
- Build Environment
- Settings

The bottom of the sidebar should contain:

- current app version
- logout button

Navigation behavior:

- `Projects` opens the project list and project detail dashboard.
- `Build Environment` opens a quick operational status page for Android SDK, Gradle, AVD, emulator, MCP, skill, agent, and verification readiness.
- `Settings` opens tabbed configuration pages grouped by feature area.
- The version display should be visible without opening a settings page.
- The logout button should be visually separated from the main navigation and pinned to the sidebar bottom.
- The first-run wizard should appear only when setup is incomplete.
- The project wizard should appear from the project creation flow, not as a persistent sidebar menu item.

Settings tabs:

- User And Password
- Email Notifications
- Build Environment
- Credentials And Secrets
- Default Project Limits
- Resource Limits
- Security And Safety
- Fail2ban Records

`User And Password` should include:

- admin id display
- password change
- current session information

`Email Notifications` should include:

- SMTP or email provider settings
- notification recipient
- test email action
- terminal-status email toggle

`Build Environment` should include:

- Android SDK settings
- Gradle settings
- JDK settings
- assigned and available toolchain snapshots
- AVD and emulator settings
- MCP install status
- skill and agent wiring status
- Codex CLI version, authentication status, JSONL dry-run status, and compatibility review status
- rerun setup or verification actions

`Credentials And Secrets` should include:

- Git SSH public key display
- uploaded secret files
- API key placeholders
- Play Console credentials
- AdMob identifiers
- keystore references

`Default Project Limits` should include:

- default max execution hours
- default max worker turns
- default retry limits
- default memory pressure thresholds for starting new jobs

`Resource Limits` should include:

- CPU/memory limits
- current memory status
- current disk status
- current CPU/load status
- minimum free memory threshold
- minimum available memory percentage threshold
- minimum free disk threshold
- maximum CPU usage threshold
- maximum load average threshold
- resource pressure wait/recheck interval
- concurrent process limits
- worker timeout behavior
- Codex turn, build, test, MCP, export, and emulator timeout settings
- stale heartbeat threshold
- active worker polling interval
- artifact retention limits
- maximum retained run logs per project
- artifact cleanup dry-run and confirmed cleanup actions

`Security And Safety` should include:

- trusted proxy configuration
- external exposure warnings
- hook trust settings
- yolo/isolation status
- secret redaction status
- worker container isolation status
- host-level fail2ban integration status

`Fail2ban Records` should show:

- recent failed login attempts
- recent successful login attempts
- currently banned IPs
- ban reason
- ban timestamp
- expiration timestamp, when available
- source log excerpt or audit id

## Two-Session Model

### Supervisor Session

The supervisor session is responsible only for deciding the next prompt.

This mirrors the user's role in the current manual workflow. The supervisor does not personally perform the work; it decides what should be asked next.

It should:

- read the worker's final response
- read backend-provided run summaries and progress state
- choose the next task
- generate the next worker prompt
- send a final-summary or final-verification prompt when terminal evidence appears close
- ask the worker to summarize user-required external actions when needed

It must not:

- edit application source code
- write tests directly
- change configuration files directly
- fix build failures directly
- create production artifacts directly
- perform code review directly
- run verification directly
- perform market research directly
- inspect repository files directly as a substitute for worker review
- decide based on hidden manual analysis that was not requested from the worker
- perform any project file mutation as a shortcut around the worker

If a file needs to be changed, the supervisor must express that as a worker prompt.

If code review, market research, roadmap audit, verification, screenshot analysis, or release readiness judgment is needed, the supervisor must ask the worker to perform that task and report concise evidence.

For example, when the supervisor believes code inspection is needed, it should send a worker prompt such as "Review the current implementation for release-blocking issues in the data layer and report findings with file references." The supervisor should not inspect the code itself.

Supervisor output style:

- Always output concise, clear instructions.
- Keep supervisor prompts to the worker under 300 words.
- Prefer a short objective, concrete task, acceptance criteria, and verification tier over long explanations.
- When the worker provides labeled next-step options, the supervisor may answer with only one option letter such as `A`.
- Do not include long rationale unless the chosen task is risky, ambiguous, or overrides the worker's suggested option.

### Worker Session

The worker session is responsible for implementation.

It should:

- read the files relevant to the assigned task
- make the requested code changes
- run required checks
- report changed files
- report verification results
- stop after the scoped task is complete

The worker should receive one coherent task per run, not the full project objective.

Worker final response format:

- Keep the final response concise.
- Summarize completed work and verification result.
- Provide suggested next actions as labeled options when useful.
- Use uppercase alphabet labels such as `A`, `B`, `C`, `D`, `E`, `F`, `G`.
- Each option should be short enough that the supervisor can choose by returning only the label.
- Do not require options when the next action is obvious or when the run failed and the fix is clear.

## Supervisor Persona

The supervisor should behave like a concise prompt director.

It should choose the next worker prompt based on:

- what app should be built and why users would care
- the worker's latest final response
- backend-provided run summaries, progress gates, and artifact links
- unresolved user-required checklist items
- whether the next prompt is specific enough for the worker to execute
- whether the next worker task should be planning, research, implementation, review, verification, fixing, or final summary

It should not accept the worker's final message as proof. The final message is only one input into next-prompt selection. When proof is missing, the supervisor should ask the worker to perform a review or verification task instead of performing that review itself.

## Supervisor Lifecycle

The supervisor loop should move the worker through the full manual process of taking an app from idea to production-ready implementation.

### 1. Product Definition

After the user decides what app to build, the supervisor should prompt the worker to establish the initial MVP.

It should:

- clarify the app's core purpose
- identify the user's expected core value
- define the minimum usable product
- identify required and optional features
- identify assumptions and unresolved questions
- record user decisions and open risks

For a new project, the first worker tasks should create `mvp.md` and `roadmap.md` before code implementation starts.

### 2. Market And Competitor Review

The supervisor should prompt the worker to review competitor apps and market expectations before finalizing the MVP.

The worker task should:

- directly search the web
- directly search Play Store results and app pages where available
- directly search relevant communities, forums, reviews, and discussion pages
- identify competing or adjacent apps
- compare expected feature sets
- identify common UX patterns users will expect
- identify differentiating features
- revise the MVP based on market evidence
- record features that are useful but not cost-effective
- record deferred features with rationale

Minimum evidence standard:

- Review at least 5 Play Store competitor or adjacent app listings when enough relevant apps exist.
- Review at least 3 community, forum, review, or discussion sources when enough relevant sources exist.
- Record source URL, source type, search query, searched region/language when relevant, crawled date, title, and short evidence summary.
- Separate observed market evidence from supervisor inference.
- If the search surface is sparse, explicitly record that limitation instead of inventing competitors.

The supervisor should ask the worker to repeat competitor review when roadmap gaps or product assumptions are discovered later.

Market research evidence should be saved as artifacts. At minimum:

- `market-review.md`
- `competitor-matrix.md`
- `community-signals.md`
- `deferred-features.md`

The worker should cite or link the sources it used and summarize why each competitor feature was implemented, deferred, or rejected.

### 3. Roadmap Planning And Audit

When the MVP is mature enough, the supervisor should prompt the worker to create a roadmap from it.

Worker roadmap audit tasks should cover:

- roadmap order
- plan contradictions
- implementation realism
- missing dependencies
- risky technical assumptions
- feature scope creep
- cost versus user value
- competitor feature coverage
- deferred item rationale

The supervisor should ask the worker to perform several roadmap refinement passes before assigning broad implementation work.

### 4. Frontend And UX Planning

Before implementation, the supervisor should ask the worker to plan the frontend according to the app's user expectation and core value.

The worker task should:

- choose UI patterns appropriate for the app domain
- plan the main user flows
- plan empty, loading, error, retry, and success states
- plan navigation, back behavior, and gestures
- plan accessibility basics
- plan phone, foldable, tablet, landscape, and large-screen behavior
- identify where convenience matters most to the user
- update the roadmap when UX planning exposes missing product work

### 5. Implementation Direction

Only after worker planning/review tasks produce sufficient evidence should the supervisor start assigning code implementation prompts.

Implementation rules:

- one roadmap item or one coherent implementation task per worker turn
- worker implements, reviews, verifies, and reports
- supervisor never edits code directly and never performs code review directly
- all code-implementable roadmap items should eventually be implemented unless explicitly deferred
- newly discovered roadmap errors should be recorded by the worker and routed by the supervisor through the next prompt
- implementation and correction repeat until roadmap and code state converge

The expected run may be long. A production-quality app can require roughly 200 to 300 supervisor/worker turns.

### 6. Roadmap-Code Gap Review

After the roadmap appears implemented, the supervisor should ask the worker to run multiple gap review passes.

Worker gap review tasks should compare:

- MVP versus roadmap
- roadmap versus implemented code
- implemented code versus user-visible behavior
- planned UI/UX versus actual screens
- deferred items versus production requirements

If a late roadmap error is found, the supervisor should choose the next worker prompt:

- update the roadmap and continue
- defer the item with rationale
- ask the user for a decision
   - block the project when a user decision or credential is required before automation can continue

### 7. QA Scenario Planning

When worker reports indicate all features are implemented, the supervisor should ask the worker to create a scenario plan for validating every feature.

The scenario plan should cover:

- every core feature
- every screen
- every primary button
- important gestures
- navigation and back behavior
- empty, loading, error, retry, and success states
- permission flows
- data entry and validation
- orientation and window-size changes
- phone, foldable, and tablet cases

### 8. Emulator And Screenshot Verification

The supervisor should prompt the worker to run scenario tests on appropriate Android targets only after roadmap implementation and gap review are substantially complete.

Emulator restriction:

- Do not run emulator/device verification during roadmap planning, roadmap audit, ordinary implementation turns, or roadmap-code gap review.
- During roadmap progress, use document review, static analysis, targeted tests, build checks, and code inspection instead.
- Emulator/device verification is allowed only in the dedicated QA scenario verification phase, terminal readiness verification, or when the user explicitly requests an immediate manual visual check.
- If an implementation turn changes UI, the supervisor may ask the worker to add tests or capture lightweight local evidence, but should defer emulator screenshots until the QA phase unless the UI is obviously broken and blocks further work.
- The supervisor should batch emulator runs because screenshots, accessibility trees, and visual analysis can consume large token and compute budgets.

Normally this should include:

- phone emulator
- foldable emulator
- tablet emulator

For each scenario, the worker should capture evidence such as logs, screenshots, or test output and report findings for:

- functional errors
- crashes
- broken navigation
- UI that differs from expectation
- inset and edge-to-edge bugs
- clipping, overlap, or unreadable text
- bad tablet/foldable layout
- missing states
- accessibility or touch-target problems

Every discovered issue should become a scoped worker task. The supervisor should ask the worker to repeat scenario testing after fixes.

### 9. Code Review And Stabilization

After functional and UI scenario testing, the supervisor should ask the worker to perform repeated full-code reviews.

Worker review passes should cover:

- architecture
- data layer
- state management
- coroutine and Flow usage
- error handling
- permissions and privacy
- security and secrets
- performance
- release packaging
- R8/ProGuard
- dependency versions
- license and policy concerns

The supervisor should continue assigning worker review/fix/retest prompts until repeated worker reports stop finding new release-blocking issues.

### 10. Production Readiness Judgment

The backend completion gate should mark the app `PRODUCTION_READY_USER_ACTION_REQUIRED` only after worker-produced evidence shows:

- planning is coherent
- roadmap and implementation have converged
- all code-implementable roadmap items are implemented or explicitly deferred
- all planned UI/UX scenarios pass
- phone, foldable, and tablet verification is complete where applicable
- screenshots and emulator evidence no longer reveal new issues
- repeated code reviews find no new release-blocking bugs
- build, test, packaging, and documentation gates pass
- all remaining work is user-owned external work the supervisor cannot complete itself

In this product, `production-ready` means the codebase is implemented to production quality and worker-run review/verification tasks no longer find new bugs or release-blocking implementation issues. It does not mean the app has already been submitted to a store. The terminal status for this condition is `PRODUCTION_READY_USER_ACTION_REQUIRED`.

When this status is reached, the supervisor should tell the user that the app is prepared to production level and list remaining user-owned work, such as:

- store registration
- policy document links
- privacy policy URL
- app icon
- feature graphic
- real ad ids
- external API keys
- OAuth setup
- DNS/domain setup
- production signing credentials when not provided

## Runtime Loop

1. User creates a project in the web UI.
2. Backend creates the project workspace.
3. For an existing project, backend clones the repository into the workspace.
4. Backend starts the supervisor session.
5. Backend provides the supervisor with current project state summaries.
6. For a new project, supervisor prompts the worker to create MVP and roadmap documents.
7. For an existing project, supervisor prompts the worker to inspect roadmap, code implementation level, build state, and verification state before choosing the next implementation task.
8. Supervisor generates the next worker prompt.
9. Backend checks system resources before starting the worker session.
10. If memory, disk, CPU, or load is outside configured thresholds, backend marks the job `waiting_resources`, waits 60 seconds, then checks again.
11. Backend starts the worker session with `codex exec --json --yolo` only after resource pressure clears.
12. Worker performs one coherent unit of work.
13. Worker exits.
14. A Stop hook calls back into the backend.
15. Backend records worker completion and wakes the supervisor loop.
16. Supervisor parses JSONL output and records:
   - thread id
   - turn status
   - exit code
   - worker final response
   - command executions
   - file changes
   - errors
17. Backend treats the worker final response as a summary claim and prepares evidence summaries.
18. Backend summarizes current project state:
   - exit code
   - JSONL error summary
   - changed files
   - git diff summary
   - build and test results
   - verification artifacts
   - roadmap/progress gate status
   - unresolved user-required items
   - sensitive data leakage scan
19. If verification is needed, supervisor asks the worker to run the risk-appropriate verification task.
20. Backend completion gate evaluates whether terminal status is already satisfied.
21. If not terminal, supervisor chooses the next prompt:
   - continue with a new Codex prompt
   - retry/fix failure
   - ask the worker for review, verification, or final summary evidence
22. On terminal status, backend emails the user.

The Stop hook is useful, but it should not be the only completion signal. The backend job runner should also watch each Codex child process directly so crashes, kills, or hook failures are still detected.

Worker polling rule:

- Stop hook delivery is not guaranteed.
- While a worker run is active, the backend must poll worker state every 5 minutes by default.
- The poll checks child process liveness, job heartbeat, timeout deadline, output artifacts, `--output-last-message` file existence, JSONL growth, and exit status when available.
- If polling detects that the worker finished but the Stop hook did not arrive, backend records completion and wakes the supervisor loop.
- If polling detects heartbeat loss or no progress beyond stale threshold, backend marks the job `stale` or failed according to recovery policy.
- The polling interval is configurable through Settings, with default `300` seconds.

Resource pressure rule:

- Before starting any new supervisor, worker, verification, build, emulator, or project export job, the backend must check system resources.
- Resources include memory, disk free space, CPU usage, and load average where measurable.
- If any required resource is outside the configured threshold, do not start the next job.
- Mark the job `waiting_resources`.
- Recheck resources every 60 seconds by default.
- Keep the project status `running` while waiting for resources unless the time/turn budget is exhausted or the user cancels.
- Do not kill an already running worker solely because resources later become pressured; instead prevent additional jobs from starting and record the pressure event.
- If resource pressure persists until the project time limit is reached, stop as `BUDGET_EXHAUSTED` and report that the project was waiting on system resources.

Hard timeout rule:

- Every long-running job must have an explicit timeout.
- Default timeouts:
  - Codex supervisor/worker turn: 3600 seconds
  - build: 1800 seconds
  - tests: 1800 seconds
  - MCP tool call: 120 seconds
  - project ZIP export: 1800 seconds
  - emulator/device verification: 3600 seconds
- When a timeout is reached, terminate the child process when possible, mark the job failed or stale according to observed process state, record artifacts, and route recovery through the next worker prompt or backend retry policy.

Restart and stale recovery rule:

- On app startup, inspect all `running` and `waiting_resources` jobs.
- If a job has no live child process and no fresh heartbeat, mark it `stale`.
- If a job is `waiting_resources`, resume 60-second resource checks.
- If a worker process disappeared after producing artifacts, parse available artifacts and let the supervisor choose a recovery prompt.
- If a worker process disappeared without usable artifacts, apply retry policy or mark failed when retries are exhausted.
- Expired project locks must be released during startup recovery.

Supervisor prompt-selection rule:

- Read the worker's final response first to understand the worker's claim.
- Read backend-provided summaries of run artifacts, logs, git diff, build/test output, and progress gates.
- If the worker's claim conflicts with backend evidence, generate a corrective worker prompt.
- Never ask the backend to mark `PRODUCTION_READY_USER_ACTION_REQUIRED`, `BLOCKED_NEEDS_USER`, `FAILED`, or `BUDGET_EXHAUSTED` from the worker final response alone.
- Never reuse sensitive values from the worker final response in a new prompt.
- Avoid full-project verification after every small turn when cheaper evidence is enough to choose the next task.
- Ask the worker to escalate verification depth when a turn touches shared architecture, build configuration, persistence, security, signing, navigation, UI framework code, release packaging, or multiple features.

## Backend Components

### 1. Web Server

Serves the UI and API.

Required endpoints:

- create project
- start project run
- stop project run
- get project status
- get project timeline history
- submit supervisor instruction
- get user-required information checklist
- update user-required information item
- get run history
- get artifact content
- request full project export
- get project export status
- download project export
- delete project export
- receive Codex hook callbacks

### 2. Codex Runner

Starts Codex sessions and stores all run artifacts.

Required outputs:

- JSONL event log
- stdout/stderr
- exit code
- start/end timestamps
- generated prompt
- resolved working directory
- Codex thread id, when available
- session role: `supervisor` or `worker`

Persistence rule:

- Store full JSONL/stdout/stderr as filesystem artifacts.
- Store supervisor prompts sent to workers and worker final responses as PostgreSQL timeline records.
- Do not store every intermediate Codex message or tool event in PostgreSQL.
- Store parsed counts, statuses, errors, and artifact links in PostgreSQL for fast UI queries.

### 3. Resource Monitor

Prevents system overload and stuck execution before launching expensive jobs.

Responsibilities:

- read container and host-visible memory, disk, CPU, and load metrics
- calculate free memory, available memory, total memory, available memory percentage, free disk, CPU usage, and load average
- compare current resources against configured thresholds
- block new supervisor, worker, verification, build, emulator, and project export jobs when resources are pressured
- mark blocked jobs as `waiting_resources`
- create `resource_checks` records for pass/wait decisions
- schedule the next resource check 60 seconds later by default
- expose current resource status in Settings and project detail views
- expose stuck states such as `waiting_resources`, `timeout`, `stale`, `disk_low`, `cpu_high`, `load_high`, and `heartbeat_missing`

Default memory thresholds:

- minimum free memory: 2048 MB
- minimum available memory percentage: 15%
- minimum free disk: 10240 MB
- recheck interval: 60 seconds
- worker status polling interval: 300 seconds

The thresholds should be configurable from Settings. The app should prefer container cgroup memory and CPU values when available, and fall back to host-visible `/proc/meminfo`, filesystem stats, and load average values when cgroup metrics are not available.

### 4. Project Exporter

Creates user-requested full-project download archives.

Responsibilities:

- accept export requests from the project detail screen
- wait for resource checks before archive creation
- compress the selected project's full project directory
- include ignored files, `keystores/`, signing files, and other project-local sensitive files by default
- exclude app-global data such as PostgreSQL files, app secrets, Codex auth, other project folders, and global tool caches unless they are inside the selected project directory
- calculate file count, total size, and SHA-256 checksum
- store the archive as an artifact with `artifact_type = 'project_export'`
- create and update `project_exports` records
- provide authenticated short-lived download access
- expire or delete old exports according to retention settings

The exporter must not rely on Git because gitignored files must be included. It should archive from the filesystem project root.

### 5. JSONL Parser

Consumes Codex JSONL output and extracts useful state.

Important event categories:

- `thread.started`
- `turn.started`
- `turn.completed`
- `turn.failed`
- `item.*`
- `error`

The parser should identify the final Codex message and any failed command or tool execution.

### 6. Project State Analyzer

Inspects the repository after every Codex run.

Checks should include:

- project type and framework
- package/build files
- current git diff
- changed files
- README and setup docs
- environment variable requirements
- deployment configuration
- tests and test coverage signals
- TODO/FIXME/placeholders
- mock/demo-only implementation
- dependency risks
- mismatch between worker final response claims and observed repository state
- whether user-required items are genuinely blocking or merely optional external setup

The analyzer should produce an evidence summary that separates:

- worker claims
- observed facts
- verification results
- supervisor inference
- unresolved uncertainty

### 7. Verifier

Runs independent checks instead of trusting Codex's final message, while avoiding unnecessary token, compute, and emulator cost.

Typical commands:

- install dependency check
- lint
- typecheck
- tests
- build
- production package or deploy dry run
- placeholder scan

The exact commands should be inferred from the project.

Verification tiers:

- `T0 metadata check`: parse worker final response, exit code, JSONL errors, changed-file list, and git diff summary. Use for documentation-only, planning-only, or clearly isolated low-risk edits.
- `T1 targeted static check`: run formatting, lint, targeted compile checks, or targeted tests for files/modules changed by the worker. Use for normal implementation turns.
- `T2 module build/test`: run affected module build, relevant unit tests, placeholder scan, and dependency/config checks. Use when changes affect multiple files, core flows, persistence, networking, build scripts, or shared UI components.
- `T3 full non-emulator verification`: run full build, full test suite, static review, placeholder scan, release-blocking configuration checks, and package dry-run when applicable. Use before major non-QA phase completion, roadmap gate promotion, or after risky architectural changes.
- `T4 emulator and release readiness verification`: run emulator/device scenario checks, screenshot review, accessibility/tree inspection where useful, release packaging checks, and final readiness review. Use only in the QA/emulator verification phase, before terminal status, or when explicitly requested by the user.

Default verification policy:

- Most worker turns should use `T0` plus `T1`.
- Use `T2` after meaningful feature completion or when `T1` is insufficient to prove the worker's claim.
- Use `T3` at non-QA phase gates, before roadmap gate promotion, after high-risk changes, or when previous non-visual evidence conflicts.
- Use `T4` only after roadmap implementation is substantially complete and the project enters QA/emulator verification, before terminal decisions, or when the user explicitly requests emulator validation.
- The supervisor may advance to the next scoped worker task with partial evidence when the remaining uncertainty is low and the next task will naturally exercise the same area.
- The supervisor must record the chosen verification tier and why it was sufficient.
- The supervisor must not run emulator/screenshot verification merely because a roadmap item or normal implementation turn completed.

### 8. Next Action Planner

Chooses exactly one next task for the worker.

Examples:

- create initial project scaffold
- implement missing feature
- replace placeholder logic
- fix build failure
- add tests around completed behavior
- wire real persistence or API calls
- improve production configuration
- prepare deployment
- write user-facing setup docs

The planner should avoid sending vague "finish the app" prompts. Each prompt should target one coherent unit of work with explicit verification.

The planner must express every required code, test, or config change as a worker instruction. The supervisor never performs those changes itself.

The planner must base the next prompt on the evidence summary, not directly on the worker final response. If the worker reports success but evidence is incomplete, the next prompt should ask for verification, gap closure, or correction before advancing a gate. For ordinary sequential implementation, the planner may continue with the next task when the selected verification tier is sufficient for the risk level and no contradictory evidence was found.

### 9. Prompt Generator

Generates the next worker prompt from the latest state.

Prompt length policy:

- The generated worker prompt should be no longer than 300 words.
- The prompt should be as short as possible while still being unambiguous.
- If the worker's last response offered labeled options and one option is clearly correct, the supervisor may send only the selected option label.
- If sending only a label would be ambiguous, include the label plus one short sentence clarifying the intended task.
- The backend should record the prompt exactly as sent, even when it is only one letter.

Each prompt should include:

- current objective
- relevant previous result
- current repo state summary
- exact task for this turn
- files or areas to inspect first
- acceptance criteria
- required verification commands
- instruction to stop after completing the scoped task

### 10. Completion Gate

Determines whether the project is done from worker-produced evidence, backend run metadata, configured limits, and user-required checklist state. The supervisor does not independently adjudicate completion; it can only ask the worker for missing final evidence.

Terminal statuses:

- `RUNNING`: supervisor automation is active or waiting for the next internal job.
- `PRODUCTION_READY_USER_ACTION_REQUIRED`: code, QA, packaging, and worker/backend-owned automation work are complete; remaining work is user-owned external setup.
- `BLOCKED_NEEDS_USER`: automation cannot continue because the supervisor needs a user decision, missing repository access, required credentials, or a file upload before more supervisor/worker work is possible.
- `BUDGET_EXHAUSTED`: configured time or turn budget ended before production readiness.
- `FAILED`: the runner or project encountered an unrecoverable failure.
- `CANCELLED`: the user explicitly stopped the project.

`PRODUCTION_READY_USER_ACTION_REQUIRED` requires:

- MVP is coherent after market and competitor review
- roadmap has passed repeated audit passes
- roadmap order, feasibility, and deferred items are documented
- frontend and UX plan matches the app's expected user value
- phone, foldable, and tablet layout strategy is implemented where applicable
- core app behavior implemented
- all code-implementable roadmap items are implemented or explicitly deferred
- roadmap-code gap review has no release-blocking findings
- no release-blocking placeholders
- no mock-only critical paths
- build passes
- tests pass or test gaps are explicitly accepted
- scenario tests cover every core feature, screen, major button, and important gesture
- emulator/device verification passes on appropriate phone, foldable, and tablet targets
- screenshot review has no unresolved UI, inset, clipping, or layout defects
- repeated full-code reviews no longer find new release-blocking issues
- deployment/package artifact exists or deployment is complete
- README/runbook explains setup and operation
- required environment variables are documented
- no unresolved critical failures remain
- any remaining work is user-owned external setup the supervisor cannot complete itself

Remaining user-owned work may include:

- store registration
- policy document or privacy policy URL preparation
- app icon
- feature graphic
- real advertising ids
- external API key issuance
- OAuth client setup
- DNS/domain setup
- Play Console or store account access

`BLOCKED_NEEDS_USER` applies when user input is required before automation can continue, such as:

- API key creation
- billing enablement
- OAuth consent setup
- DNS changes
- app signing credentials
- missing Git access
- missing project clarification required for roadmap correctness
- legal or policy approval
- production account access

## Sensitive File Policy

Keystores and other sensitive files should be stored outside normal source control.

Rules:

- Each project should have a `keystores/` directory when signing material is needed.
- `keystores/` must be registered in `.gitignore`.
- Release keystores, debug keystores copied from the user, signing property files, and keystore passwords must never be committed.
- The supervisor should ask the worker or backend verification job to confirm `.gitignore` protects `keystores/` before any commit.
- The worker may create or update `.gitignore` when instructed by the supervisor.
- Secret values should be stored in the app's secret storage or ignored files only.
- Secret values must not appear in Codex prompts, JSONL logs, screenshots, email notifications, or commit messages.

### 11. Email Notifier

Sends one final email when the backend completion gate reaches a terminal state.

Email should include:

- final status
- project path
- summary of completed work
- verification results
- deployment URL or artifact path, if available
- user actions required, if blocked
- failed command/log summary, if failed

## MVP Scope

The first MVP should support a Dockerized single-node web app and one active project at a time.

Included:

- Docker image
- web dashboard
- first-run setup wizard
- Android-only Kotlin project scope
- single-user admin authentication
- fail2ban login protection with 3-failure IP ban
- configurable project execution time and turn limits
- automatic per-turn Git versioning and commits
- PostgreSQL application database
- versioned database migrations
- default Android MCP setup through the wizard
- bundled product-owned skills and agents in the image
- repository-installed skills and agents through the wizard
- skill and agent wiring through the wizard
- backend API
- job runner
- project full-folder export and download
- one project directory
- two Codex-backed sessions per project: `supervisor` and `worker`
- `codex exec --json --yolo` runner for both sessions
- JSONL log parser
- Android/dev/build tool installer
- AVD setup and verification
- MCP/skill/agent installer and verifier
- persisted project state
- prompt generator
- basic project analyzer
- basic verifier
- terminal email notification

Excluded from MVP:

- App Factory Autopilot as a default dependency
- Sequential Thinking MCP as a default dependency
- multi-tenant support
- cloud workers
- concurrent project execution
- cost optimization
- full dependency/license policy engine
- app store automation
- production secrets management

## Suggested File Structure

```text
app-factory-supervisor/
  mvp.md
  Dockerfile
  docker-compose.yml
  package.json
  src/
    server/
      index.ts
      routes.ts
      db.ts
      migrations/
      auth.ts
      auth-log.ts
    ui/
      App.tsx
      components/
        Sidebar.tsx
        WizardPage.tsx
        ProjectsPage.tsx
        ProjectDetailPage.tsx
        ProgressOverview.tsx
        SupervisorWorkerTimeline.tsx
        WorkerLatestMessage.tsx
        UserRequiredChecklist.tsx
        SupervisorInstructionInput.tsx
        BuildEnvironmentPage.tsx
        SettingsPage.tsx
    core/
      runner.ts
      resource-monitor.ts
      project-exporter.ts
      jsonl-parser.ts
      project-analyzer.ts
      verifier.ts
      planner.ts
      prompt-generator.ts
      notifier.ts
      state-store.ts
      hooks.ts
      toolchain/
        detector.ts
        installer.ts
        verifier.ts
        versions.ts
      capabilities/
        mcp-catalog.ts
        skill-catalog.ts
        agent-catalog.ts
        source-catalog.ts
        installer.ts
        verifier.ts
      codex-docs/
        indexer.ts
        compatibility-reviewer.ts
        query.ts
      schemas/
        supervisor-output.schema.json
        worker-output.schema.json
  assets/
    skills/
    agents/
  manifests/
    capabilities.json
    fail2ban-filter.conf
    fail2ban-jail.conf
  data/
    projects/
    runs/
    toolchains/
    capabilities/
  templates/
    prompts/
      supervisor.md
      next-task.md
      failure-retry.md
      verification-fix.md
```

## State Model

Minimum persisted state:

```json
{
  "projectId": "string",
  "projectDir": "string",
  "goal": "string",
  "status": "running | production_ready_user_action_required | blocked_needs_user | failed | budget_exhausted | cancelled",
  "iteration": 0,
  "limits": {
    "maxExecutionHours": 24,
    "maxWorkerTurns": 200,
    "startedAt": "ISO-8601",
    "activeWorkerMayFinishAfterLimit": true,
    "minFreeMemoryMb": 2048,
    "minAvailableMemoryPercent": 15,
    "minFreeDiskMb": 10240,
    "maxCpuUsagePercent": 90,
    "maxLoadAverage": 0,
    "resourceRecheckIntervalSeconds": 60,
    "codexTurnTimeoutSeconds": 3600,
    "buildTimeoutSeconds": 1800,
    "testTimeoutSeconds": 1800,
    "mcpToolTimeoutSeconds": 120,
    "exportTimeoutSeconds": 1800,
    "emulatorTimeoutSeconds": 3600,
    "staleHeartbeatSeconds": 180,
    "workerPollIntervalSeconds": 300
  },
  "resources": {
    "overallStatus": "ok | waiting | unknown | timeout | stale",
    "memoryStatus": "ok | waiting | unknown",
    "diskStatus": "ok | waiting | unknown",
    "cpuStatus": "ok | waiting | unknown",
    "loadStatus": "ok | waiting | unknown",
    "availableMemoryMb": 0,
    "freeMemoryMb": 0,
    "totalMemoryMb": 0,
    "availableMemoryPercent": 0,
    "freeDiskMb": 0,
    "cpuUsagePercent": 0,
    "loadAverage": 0,
    "nextResourceCheckAt": "ISO-8601",
    "waitingJobId": "string",
    "staleJobIds": ["string"],
    "timedOutJobIds": ["string"],
    "lastResourceCheckAt": "ISO-8601",
    "lastResourceWaitReason": "string"
  },
  "versioning": {
    "semanticVersion": "major.minor.patch",
    "runSuffix": "yymmddrrr",
    "currentVersion": "1.4.12+260809003",
    "lastCommitSha": "string",
    "lastPushedCommitSha": "string"
  },
  "sessions": {
    "supervisor": {
      "lastRunId": "string",
      "lastThreadId": "string",
      "lastPromptPath": "string",
      "lastJsonlPath": "string",
      "lastPromptSentToWorker": "string",
      "lastPromptWordCount": 0,
      "lastPromptWasOptionOnly": false,
      "lastSelectedWorkerOption": "A | B | C | D | E | F | G | null"
    },
    "worker": {
      "lastRunId": "string",
      "lastThreadId": "string",
      "lastPromptPath": "string",
      "lastJsonlPath": "string",
      "lastFinalResponse": "string",
      "lastSuggestedOptions": ["A", "B", "C"]
    }
  },
  "verification": {
    "build": "pass | fail | skipped",
    "tests": "pass | fail | skipped",
    "lint": "pass | fail | skipped",
    "placeholderScan": "pass | fail | skipped",
    "lastTier": "T0 | T1 | T2 | T3 | T4",
    "tierRationale": "string"
  },
  "progress": {
    "percent": 0,
    "phase": "product_definition | market_review | roadmap_planning | ux_planning | implementation | gap_review | qa_planning | emulator_verification | code_review | production_ready_user_action_required",
    "nextAction": "string",
    "roadmapStatus": "missing | stale | partial | usable | complete",
    "implementationLevel": "unknown | empty | scaffolded | partial | mostly_complete | production_ready",
    "reviewPasses": {
      "mvp": 0,
      "competitor": 0,
      "roadmap": 0,
      "ux": 0,
      "gap": 0,
      "scenario": 0,
      "screenshot": 0,
      "code": 0
    },
    "gates": [
      {
        "id": "string",
        "label": "string",
        "status": "pending | pass | fail | blocked | skipped",
        "weight": 0,
        "evidencePath": "string"
      }
    ]
  },
  "downloads": {
    "latestExportId": "string",
    "latestExportStatus": "queued | running | ready | failed | expired | deleted",
    "latestExportPath": "string",
    "latestExportSizeBytes": 0,
    "latestExportFileCount": 0,
    "latestExportSha256": "string",
    "latestExportIncludesKeystores": true,
    "latestExportExpiresAt": "ISO-8601"
  },
  "userRequiredInformation": [
    {
      "id": "string",
      "label": "string",
      "status": "needed | provided | pass | failed | blocked",
      "requiredForProduction": true,
      "canContinueWithoutIt": false,
      "secret": false,
      "lastValidation": "string"
    }
  ],
  "marketResearch": {
    "playStoreSearched": true,
    "communitiesSearched": true,
    "marketReviewPath": "string",
    "competitorMatrixPath": "string",
    "communitySignalsPath": "string",
    "deferredFeaturesPath": "string"
  },
  "supervisorInstructions": [
    {
      "id": "string",
      "text": "string",
      "status": "queued | reviewed | applied | rejected",
      "createdAt": "ISO-8601"
    }
  ],
  "account": {
    "adminId": "string",
    "passwordConfigured": true
  },
  "toolchain": {
    "status": "not_started | installing | ready | failed",
    "installPath": "string",
    "versionsPath": "string",
    "lastVerifiedAt": "ISO-8601"
  },
  "git": {
    "repositoryUrl": "string",
    "projectType": "new | existing",
    "globalUserName": "string",
    "globalUserEmail": "string",
    "remoteReachable": true,
    "sshPublicKeyPath": "string",
    "lastVerifiedAt": "ISO-8601"
  },
  "androidApp": {
    "projectName": "string",
    "appName": "string",
    "packageName": "string",
    "platform": "android",
    "language": "kotlin",
    "userAppPlan": "string",
    "releaseKeystoreStatus": "created | uploaded | upload_later | missing"
  },
  "capabilities": {
    "status": "not_started | installing | ready | failed",
    "mcpServers": [
      {
        "id": "string",
        "sourceType": "wizard",
        "package": "string",
        "version": "string",
        "wiredTo": ["supervisor", "worker"],
        "status": "ready | failed | disabled"
      }
    ],
    "skills": [
      {
        "id": "string",
        "sourceType": "bundled | repository | user",
        "source": "string",
        "revision": "string",
        "wiredTo": ["supervisor", "worker"],
        "status": "ready | failed | disabled"
      }
    ],
    "agents": [
      {
        "id": "string",
        "sourceType": "bundled | repository | user",
        "source": "string",
        "revision": "string",
        "wiredTo": ["supervisor"],
        "status": "ready | failed | disabled"
      }
    ],
    "lastVerifiedAt": "ISO-8601"
  },
  "codexDocs": {
    "status": "not_started | indexing | ready | failed",
    "indexName": "openai-codex",
    "storePath": "string",
    "documentCount": 0,
    "uniqueUrlCount": 0,
    "codexCliVersion": "string",
    "lastIndexedAt": "ISO-8601",
    "compatibilityReviewStatus": "pass | fail | stale"
  },
  "pendingUserActions": [],
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

## Safety Requirements

- Run `--yolo` only inside the Dockerized isolated environment.
- Do not expose the web app beyond setup routes until admin id and password are configured.
- Protect login with fail2ban and ban IPs after 3 failed password attempts.
- Require correct trusted proxy configuration before relying on forwarded client IPs for banning.
- Do not start supervisor or worker sessions until the setup wizard verifies the required toolchain.
- Do not start supervisor or worker sessions until the project wizard has collected project name, app name, package name, project type, repository URL, and global Git identity.
- Do not start supervisor or worker sessions until required default capabilities are installed and verified.
- Do not start supervisor or worker sessions until project execution limits are configured.
- Do not start supervisor or worker sessions until Codex official docs are indexed and compatibility review passes.
- Do not start new supervisor, worker, verification, build, export, or emulator jobs while memory, disk, CPU, or load is outside configured thresholds.
- Recheck resources every 60 seconds by default while jobs are waiting for resources.
- Enforce hard timeouts for Codex turns, builds, tests, MCP tool calls, project exports, and emulator jobs.
- Detect stale jobs through heartbeats and recover them on app startup.
- Show operator-visible stuck states for resource wait, timeout, stale job, disk low, CPU high, load high, and missing heartbeat.
- Install MCP servers only through the setup wizard, not as pre-wired image state.
- Bundle only product-owned skills and agents in the image.
- Download repository-owned skills and agents during the setup wizard.
- Do not install App Factory Autopilot or Sequential Thinking as default capabilities.
- Keep every prompt, JSONL log, verification result, and final decision as an artifact.
- Enforce max worker turns.
- Set max retries per failure type.
- Enforce max wall-clock duration, allowing an already-started worker turn to finish.
- Verify `keystores/` is ignored before committing.
- Allow authenticated full-project exports that include project-local ignored files and `keystores/`, while excluding app-global secrets and other projects.
- Treat project export archives as sensitive artifacts with audit logs, short-lived download access, checksum, and expiration.
- Never store secrets in prompts or logs.
- Treat Codex final messages as claims, not proof.
- Require worker-run verification evidence before the backend completion gate marks production-ready.
- Re-run Codex compatibility review after Codex CLI upgrades.

## MVP Success Criteria

The MVP is successful when it can:

1. Run as a Dockerized web app.
2. Run a first-launch setup wizard.
3. Configure admin id and password.
4. Protect login with fail2ban and a 3-failed-password IP ban.
5. Install and verify Android, build, Python, image, Base64, keystore, AVD, Gradle, and related development tools.
6. Generate or reuse SSH key material and show the Git public key registration instructions.
7. Install all default MCP servers through the wizard.
8. Wire bundled product-owned skills and agents into Codex through the wizard.
9. Download, install, and wire repository-owned skills and agents through the wizard.
10. Index official Codex documentation with `mobile-docs`.
11. Run Codex compatibility review against the installed Codex CLI and indexed docs.
12. Generate Codex app-server TypeScript and JSON Schema artifacts for the installed Codex version.
13. Validate generated Codex `config.toml` against the Codex config schema.
14. Detect and report app-managed versus user-managed Codex config/hook ownership conflicts.
15. Persist installed tool versions, SSH setup, capability versions, Codex docs index status, sources, revisions, generated schemas, config validation, ownership reports, and setup results.
16. Create a project from the project wizard.
17. Collect project name, app name, package name, user app plan, project type, repository URL, global Git identity, max execution hours, and max worker turns.
18. For a new project, create a release keystore.
19. For an existing project, allow release keystore upload later.
20. Configure Android-only Kotlin project assumptions.
21. Start a supervisor session for the project.
22. Pause next-job startup when system memory is below configured thresholds and retry every 60 seconds.
23. Pause next-job startup when disk, CPU, or load is outside configured thresholds and retry every 60 seconds.
24. Enforce job timeouts and stale heartbeat recovery.
25. Resume or safely mark stale jobs after app/container restart.
26. Prompt the worker to run Play Store, web, and community market research.
27. Generate a scoped worker prompt.
28. Run the worker session in JSON mode with `--yolo`.
29. Detect worker completion through process exit and/or Stop hook.
30. Parse the worker's final message.
31. Record backend repo-state summaries after the run.
32. Prompt the worker or backend verifier to run project-appropriate verification.
33. Commit changed files with automatic versioning after each successful worker turn.
34. Push after large phase-level work units.
35. Decide the next task automatically.
36. Allow the user to request and download a full compressed project archive at any time, including project-local `keystores/` files.
37. Continue until terminal status, configured limits, or user-owned external work remains.
38. Send a final email with status, evidence, and remaining user-owned work.
