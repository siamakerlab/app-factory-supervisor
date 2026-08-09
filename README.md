# App Factory Supervisor

**This project is not complete yet. It is under active development and should not be treated as production-ready software.**

App Factory Supervisor is a Codex-only web application for running long Android app development projects with a supervised automation loop. It is designed for Android/Kotlin projects only.

The app uses two Codex-backed sessions per project:

- `supervisor`: decides the next short prompt to send to the worker.
- `worker`: performs the actual work, including planning, research, implementation, review, testing, fixing, and reporting.

The supervisor never edits code directly. It watches project state, reads the worker's final response and backend summaries, then sends the next scoped instruction. The backend records run state, artifacts, progress, and completion evidence.

## Scope

This project is intentionally narrow:

- Codex-only automation.
- Android-only app projects.
- Kotlin-only app implementation.
- Docker Compose deployment.
- Single-user web app.
- PostgreSQL for durable state.
- ZIP project exports.
- LGPL licensed supervisor app.

It is not intended to supervise iOS, Flutter, React Native, backend-only, or general-purpose software projects in the MVP.

## Architecture

Planned stack:

- TypeScript
- Node.js LTS
- React + Vite
- TanStack Router
- TanStack Query
- Tailwind CSS
- Radix UI primitives
- lucide-react icons
- Fastify
- PostgreSQL
- Drizzle ORM
- Docker Compose

Codex runs as a child process inside the app container:

```bash
codex exec --json --yolo
```

The app stores only structured state, prompt history, worker final responses, summaries, and artifact references in PostgreSQL. Full JSONL streams, logs, screenshots, builds, exports, and reports are stored as filesystem artifacts.

## Installation

The implementation is still being built, so these commands describe the intended deployment flow.

Clone the repository:

```bash
git clone ssh://git@gitea.wody.kr:2929/wody/app-factory-supervisor.git
cd app-factory-supervisor
```

Start the stack:

```bash
docker compose up -d
```

Open the web app and complete the first-run wizard.

For local scaffold development:

```bash
npm install
npm run typecheck
npm run lint
npm run test
npm run build
npm run dev
```

Validate the Compose file:

```bash
docker compose config
```

The first-run wizard is expected to:

- create the single admin account
- install and verify the build environment
- configure Codex authentication
- install Android SDK, Gradle, JDK, AVD, emulator, Python, image tools, archive tools, and keystore tools
- install required MCP servers
- install or wire required skills and agents
- show the generated SSH public key for Git access
- verify Git, Codex, Android, and build tooling

Heavy Android tooling is installed during first run into a persistent volume. It is not intended to be fully baked into the Docker image.

## Usage

Create a project from the web UI.

For a new project, provide:

- project name
- app name
- Android package name
- short description of the app you want to build
- empty Git repository URL
- Git `user.name`
- Git `user.email`
- max execution hours
- max worker turns

For an existing project, provide the existing repository URL. The worker should clone it, inspect planning documents, evaluate implementation state, and continue from the current project state instead of restarting from scratch.

The project screen should show:

- progress overview
- supervisor prompt history
- worker final response history
- latest worker message
- verification status
- user-required checklist
- artifacts
- full project ZIP export
- direct instruction input for the supervisor

## Git Automation

The app is planned to manage Git automatically:

- Commit after every completed unit of work with file changes.
- Use English commit messages.
- Include version information in automated commits.
- Increment patch versions per completed unit-of-work commit.
- Increment minor versions after meaningful feature or phase completion.
- Push after phase-level completion or another configured large boundary.
- Never commit or push ignored sensitive files.

The default version format is:

```text
major.minor.patch+yymmddrrr
```

## Important Safety Notes

Codex sessions run with `--yolo`, which bypasses normal approval and sandbox prompts. This is intentionally powerful and dangerous.

Use this app only inside an isolated environment. The worker should only have access to the selected project workspace and explicitly allowed build/cache paths. App secrets, SMTP credentials, PostgreSQL data, Codex auth files, and global secret storage must not be mounted writable into worker workspaces.

Additional planned safeguards:

- explicit environment allowlist
- sensitive path denylist
- resource checks before jobs
- hard timeouts for long-running jobs
- worker heartbeat checks
- Stop hook fallback polling
- artifact capture
- secret redaction
- fail2ban integration for login protection

Hooks are treated as callbacks and guardrails, not as the main security boundary.

## Production Readiness Definition

A generated Android app is considered production-ready only when the backend completion gate has enough evidence that:

- the MVP is coherent
- the roadmap has been audited
- implementation matches the roadmap
- deferred items are documented
- core behavior is implemented
- builds and tests pass or accepted gaps are documented
- emulator/device verification has passed where applicable
- screenshot review has no unresolved release-blocking UI defects
- repeated worker reviews find no release blockers
- only user-owned external actions remain

User-owned external actions may include Play Store submission, privacy policy URL, API keys, OAuth approval, AdMob IDs, billing setup, app icon, feature graphic, signing credentials, and production account access.

## License

This project is licensed under LGPL using SPDX identifier `LGPL-3.0-or-later` by default.

Generated Android app projects should define their own license separately.
