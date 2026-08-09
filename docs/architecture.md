# Architecture Notes

## Runtime Shape

The MVP is a single Docker Compose deployment with two services:

- `app`: Fastify API, React web assets, Codex child-process runner, setup installers, and job runner.
- `postgres`: durable PostgreSQL state.

Persistent state is split across PostgreSQL, `/app/data`, and `/app/projects`.

## Backend Modules

- `auth`: single-admin setup, login, sessions, password changes, and auth failure logging.
- `settings`: operator settings, defaults, SMTP notification configuration, and audit records.
- `setup`: first-run wizard state.
- `toolchain`: Android/Kotlin build environment installation and snapshots.
- `capabilities`: MCP, skill, and agent inventory, installation, and app-managed Codex config wiring.
- `codex`: compatibility review, docs index, hooks, JSONL parsing, and runner command construction.
- `projects`: project wizard, project detail, checklist, timeline, completion gate, and run history.
- `jobs`: queued work, resource waiting, heartbeat/timeout deadlines, locks, and stale recovery.
- `artifacts`: filesystem artifact metadata and verification.
- `exports`: full project ZIP creation, verification, download, and deletion.
- `notifications`: terminal project email notifications.
- `security`: fail2ban records, secret scanning, and worker isolation status.

## Database Schema

Migrations are defined in `src/server/db/migrations.ts`. The schema is append-only through numbered
migrations and includes indexes for job status, project state, artifacts, auth logs, resource checks,
and run history. The `app_settings` singleton row stores default limits and resource thresholds.

## Prompt And Run Flow

The project timeline alternates supervisor prompts and worker final responses. The backend stores
only the supervisor prompt and worker final response in the main timeline; full JSONL and stderr are
stored as artifacts.

## Production Readiness Gate

Production readiness means all code work the supervisor can perform is complete, no new bugs are
being found, and only user-owned external actions remain.
