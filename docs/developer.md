# Developer Guide

## Architecture

The app is a TypeScript/Fastify backend with a React/Vite frontend. PostgreSQL stores durable state.
Large outputs are filesystem artifacts under app data.

Project automation uses two roles:

- `supervisor`: chooses the next short prompt.
- `worker`: performs planning, implementation, review, testing, and reporting.

The supervisor does not edit code. It only sends prompts and decides whether another worker action is
needed.

## Database Schema

Migrations live in `src/server/db/migrations.ts`. Core tables cover settings, users, sessions,
projects, runs, jobs, resource checks, artifacts, exports, capabilities, Codex compatibility, docs
indexes, notifications, and audit events.

## Job Runner

`JobService` owns queueing, resource waiting, heartbeat deadlines, timeout deadlines, project locks,
and stale-job recovery. Resource checks are recorded so operators can see why automation is waiting.

## Codex Runner

`CodexRunnerService` builds `codex exec --json --yolo` commands with output schema, JSONL, stderr,
prompt, and final-message artifacts. Worker processes inherit only the explicit environment allowlist
from `src/server/security/isolation.ts`.

## Prompt Contracts

Supervisor prompts must be short and direct. Worker outputs are expected to include task type,
summary, changed files, verification, blockers, next actions, and suggested options. The worker may
offer next actions as option letters `A` through `G`; the supervisor may answer with a single letter.

## Verification Tiers

Verification tiers classify evidence quality. Low-risk text or schema changes may use light checks.
Changes that affect shared behavior, project execution, security, exports, or automation gates need
broader tests and build verification.

## Git Automation Policy

Every completed unit with file changes should produce an automatic commit with an English message.
Patch versions increment per completed unit. Larger phase boundaries push to the configured remote.
Sensitive ignored files must never be committed.
