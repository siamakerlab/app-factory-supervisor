# Security Notes

## Same-Container Worker Limitations

The MVP runs Codex as a child process in the same container. This is not a hard sandbox. Normal
runner configuration limits the worker cwd and environment, but an isolated host or container
deployment remains required.

## `--yolo` Risk

Managed runs use `codex exec --json --yolo`. This bypasses approval prompts and is suitable only for
isolated project workspaces. Do not mount host secrets, personal home directories, or unrelated
source trees into the project volume.

## Secret Handling

The app keeps app-level secrets under app data, excludes app-global secret paths from the worker
environment, ignores Android signing files in project Git, and redacts common secret patterns before
persisting logs or notification bodies. Redaction is best-effort and does not make logs public.

## Project Export Sensitivity

Full project ZIP exports intentionally include the project folder and may include ignored files and
`keystores/`. Treat exports as confidential backups, not public release artifacts.

## Hooks

Codex hooks are used for Stop and SessionEnd callbacks plus advisory guardrails. Missing or delayed
hooks are handled by periodic worker-state polling. Hooks must not be treated as the main security
boundary.
