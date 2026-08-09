export type Migration = {
  id: string;
  description: string;
  sql: string;
};

export const migrations: Migration[] = [
  {
    id: "0001_mvp_schema",
    description: "Create MVP PostgreSQL schema",
    sql: `
create table if not exists users (
  id uuid primary key,
  admin_id text not null unique,
  password_hash text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists login_attempts (
  id uuid primary key,
  admin_id text,
  ip_address inet not null,
  user_agent text,
  success boolean not null,
  failure_reason text,
  created_at timestamptz not null
);

create table if not exists user_sessions (
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

create table if not exists banned_ips (
  id uuid primary key,
  ip_address inet not null unique,
  reason text not null,
  source text not null default 'fail2ban',
  banned_at timestamptz not null,
  expires_at timestamptz
);

create table if not exists secrets (
  id uuid primary key,
  secret_type text not null,
  storage_path text not null,
  description text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists app_settings (
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
  smtp_secret_id uuid references secrets(id) on delete set null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint app_settings_singleton check (id)
);

create table if not exists projects (
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

create table if not exists project_git_settings (
  project_id uuid primary key references projects(id) on delete cascade,
  global_user_name text not null,
  global_user_email text not null,
  ssh_public_key_path text not null,
  remote_reachable boolean not null default false,
  last_verified_at timestamptz
);

create table if not exists project_version_state (
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

create table if not exists toolchain_snapshots (
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

create table if not exists project_toolchain_snapshots (
  project_id uuid primary key references projects(id) on delete cascade,
  toolchain_snapshot_id uuid not null references toolchain_snapshots(id),
  assigned_at timestamptz not null
);

create table if not exists runs (
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

create table if not exists jobs (
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

create table if not exists resource_checks (
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

create table if not exists project_locks (
  project_id uuid primary key references projects(id) on delete cascade,
  lock_owner text not null,
  lock_reason text not null,
  locked_at timestamptz not null,
  expires_at timestamptz
);

create table if not exists process_heartbeats (
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

create table if not exists artifacts (
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

create table if not exists timeline_events (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  run_id uuid references runs(id) on delete set null,
  iteration integer not null,
  event_type text not null check (event_type in ('supervisor_prompt_sent', 'worker_final_response')),
  title text not null,
  body text,
  body_artifact_id uuid references artifacts(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

create table if not exists progress_gates (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  gate_key text not null,
  label text not null,
  phase text not null,
  status text not null check (status in ('pending', 'pass', 'fail', 'blocked', 'skipped')),
  weight integer not null default 1,
  evidence_artifact_id uuid references artifacts(id) on delete set null,
  updated_at timestamptz not null,
  unique (project_id, gate_key)
);

create table if not exists user_required_items (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  item_key text not null,
  label text not null,
  status text not null check (status in ('needed', 'provided', 'pass', 'failed', 'blocked')),
  required_for_production boolean not null default true,
  can_continue_without_it boolean not null default false,
  secret boolean not null default false,
  secret_id uuid references secrets(id) on delete set null,
  last_validation text,
  updated_at timestamptz not null,
  unique (project_id, item_key)
);

create table if not exists verification_results (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  run_id uuid references runs(id) on delete set null,
  check_type text not null,
  status text not null check (status in ('pass', 'fail', 'skipped')),
  command text,
  summary text,
  artifact_id uuid references artifacts(id) on delete set null,
  created_at timestamptz not null
);

create table if not exists project_exports (
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

create table if not exists market_research (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  source_type text not null,
  source_url text,
  title text,
  summary text not null,
  evidence_artifact_id uuid references artifacts(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

create table if not exists deferred_features (
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

create table if not exists capability_installations (
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

create table if not exists codex_doc_indexes (
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

create table if not exists codex_compatibility_reviews (
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
  artifact_id uuid references artifacts(id) on delete set null,
  created_at timestamptz not null
);

create table if not exists notifications (
  id uuid primary key,
  project_id uuid references projects(id) on delete cascade,
  notification_type text not null,
  recipient text not null,
  status text not null,
  subject text not null,
  body_artifact_id uuid references artifacts(id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_runs_prompt_artifact') then
    alter table runs add constraint fk_runs_prompt_artifact foreign key (prompt_artifact_id) references artifacts(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_runs_jsonl_artifact') then
    alter table runs add constraint fk_runs_jsonl_artifact foreign key (jsonl_artifact_id) references artifacts(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_runs_worker_final_response_artifact') then
    alter table runs add constraint fk_runs_worker_final_response_artifact foreign key (worker_final_response_artifact_id) references artifacts(id) on delete set null;
  end if;
end $$;

create index if not exists idx_projects_status on projects(status);
create index if not exists idx_runs_project_iteration on runs(project_id, iteration);
create index if not exists idx_runs_status on runs(status);
create index if not exists idx_jobs_project_status on jobs(project_id, status, scheduled_at);
create index if not exists idx_jobs_heartbeat on jobs(status, heartbeat_at);
create index if not exists idx_resource_checks_job_checked on resource_checks(job_id, checked_at);
create index if not exists idx_user_sessions_user_expires on user_sessions(user_id, expires_at);
create index if not exists idx_timeline_project_created on timeline_events(project_id, created_at);
create index if not exists idx_artifacts_project_type on artifacts(project_id, artifact_type);
create index if not exists idx_project_exports_project_status on project_exports(project_id, status, requested_at);
create index if not exists idx_verification_project_created on verification_results(project_id, created_at);
create index if not exists idx_market_research_project_source on market_research(project_id, source_type);
create index if not exists idx_progress_gates_project_status on progress_gates(project_id, status);

insert into app_settings (id, created_at, updated_at)
values (true, now(), now())
on conflict (id) do nothing;
`
  },
  {
    id: "0002_settings_audit",
    description: "Add settings retry default and app audit events",
    sql: `
alter table app_settings
  add column if not exists default_retry_limit integer not null default 1;

create table if not exists app_audit_events (
  id uuid primary key,
  event_type text not null,
  actor_type text not null,
  actor_id text,
  ip_address inet,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

create index if not exists idx_app_audit_events_type_created on app_audit_events(event_type, created_at);
`
  },
  {
    id: "0003_setup_wizard",
    description: "Add first-run setup wizard state",
    sql: `
create table if not exists setup_wizard_state (
  id boolean primary key default true,
  admin_step_status text not null default 'pending' check (admin_step_status in ('pending', 'pass', 'fail')),
  environment_step_status text not null default 'pending' check (environment_step_status in ('pending', 'pass', 'fail')),
  ssh_step_status text not null default 'pending' check (ssh_step_status in ('pending', 'pass', 'fail')),
  setup_complete boolean not null default false,
  os_name text,
  cpu_arch text,
  install_paths jsonb not null default '{}'::jsonb,
  command_checks jsonb not null default '[]'::jsonb,
  ssh_public_key_path text,
  last_error text,
  updated_at timestamptz not null,
  constraint setup_wizard_state_singleton check (id)
);

insert into setup_wizard_state (id, updated_at)
values (true, now())
on conflict (id) do nothing;
`
  },
  {
    id: "0004_codex_compatibility_metadata",
    description: "Add Codex compatibility review metadata",
    sql: `
alter table codex_compatibility_reviews
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_codex_compatibility_reviews_created
  on codex_compatibility_reviews(created_at desc);
`
  },
  {
    id: "0005_toolchain_install_runs",
    description: "Track Android toolchain installer runs",
    sql: `
create table if not exists toolchain_install_runs (
  id uuid primary key,
  status text not null check (status in ('not_started', 'running', 'succeeded', 'failed')),
  install_root text not null,
  android_home text not null,
  gradle_home text not null,
  avd_home text not null,
  steps jsonb not null default '[]'::jsonb,
  resolved_versions jsonb not null default '{}'::jsonb,
  verification jsonb not null default '[]'::jsonb,
  snapshot_id uuid references toolchain_snapshots(id) on delete set null,
  artifact_id uuid references artifacts(id) on delete set null,
  error_summary text,
  started_at timestamptz not null,
  finished_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_toolchain_install_runs_started
  on toolchain_install_runs(started_at desc);
`
  },
  {
    id: "0006_capability_install_runs",
    description: "Track MCP, skill, and agent capability installer runs",
    sql: `
create table if not exists capability_install_runs (
  id uuid primary key,
  status text not null check (status in ('not_started', 'running', 'succeeded', 'failed')),
  config_path text not null,
  capabilities_root text not null,
  installed_count integer not null default 0,
  required_count integer not null default 0,
  missing_required_count integer not null default 0,
  conflict_summary text,
  artifact_id uuid references artifacts(id) on delete set null,
  steps jsonb not null default '[]'::jsonb,
  started_at timestamptz not null,
  finished_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_capability_install_runs_started
  on capability_install_runs(started_at desc);
`
  },
  {
    id: "0007_project_git_automation_events",
    description: "Track project versioning, unit commits, and phase pushes",
    sql: `
create table if not exists project_git_automation_events (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  event_type text not null check (event_type in ('unit_commit', 'phase_push', 'push_failed', 'commit_skipped')),
  unit_type text,
  scope text,
  phase text,
  version text not null,
  verification_tier text,
  commit_sha text,
  pushed_commit_sha text,
  status text not null check (status in ('succeeded', 'failed', 'skipped')),
  summary text not null,
  command_output text,
  created_at timestamptz not null
);

create index if not exists idx_project_git_automation_events_project_created
  on project_git_automation_events(project_id, created_at desc);
`
  },
  {
    id: "0008_artifact_storage_metadata",
    description: "Add artifact storage retention and verification metadata",
    sql: `
alter table artifacts
  add column if not exists retention_class text not null default 'run_log',
  add column if not exists compressed_at timestamptz,
  add column if not exists verified_at timestamptz,
  add column if not exists deleted_at timestamptz;

create index if not exists idx_artifacts_created
  on artifacts(created_at desc);

create index if not exists idx_artifacts_retention
  on artifacts(retention_class, created_at)
  where deleted_at is null;
`
  }
];

export const expectedMvpTables = [
  "users",
  "login_attempts",
  "user_sessions",
  "banned_ips",
  "app_settings",
  "projects",
  "project_git_settings",
  "project_version_state",
  "project_git_automation_events",
  "toolchain_snapshots",
  "project_toolchain_snapshots",
  "toolchain_install_runs",
  "capability_install_runs",
  "runs",
  "jobs",
  "resource_checks",
  "project_locks",
  "process_heartbeats",
  "timeline_events",
  "progress_gates",
  "user_required_items",
  "verification_results",
  "artifacts",
  "project_exports",
  "market_research",
  "deferred_features",
  "capability_installations",
  "codex_doc_indexes",
  "codex_compatibility_reviews",
  "secrets",
  "notifications"
] as const;

export const expectedMvpIndexes = [
  "idx_projects_status",
  "idx_runs_project_iteration",
  "idx_runs_status",
  "idx_jobs_project_status",
  "idx_jobs_heartbeat",
  "idx_resource_checks_job_checked",
  "idx_user_sessions_user_expires",
  "idx_timeline_project_created",
  "idx_artifacts_project_type",
  "idx_project_exports_project_status",
  "idx_verification_project_created",
  "idx_market_research_project_source",
  "idx_progress_gates_project_status",
  "idx_codex_compatibility_reviews_created",
  "idx_toolchain_install_runs_started",
  "idx_capability_install_runs_started",
  "idx_project_git_automation_events_project_created",
  "idx_artifacts_created",
  "idx_artifacts_retention"
] as const;
