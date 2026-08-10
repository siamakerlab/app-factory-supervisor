# Operations Runbook

This runbook covers day-to-day operation for the single-user Docker Compose deployment.

## Current Production Instance

Last reviewed: 2026-08-10 KST.

- Public URL: `https://supervisor.codr.kr`
- Reverse proxy target: host port `3090`, forwarded to container port `3000`
- Compose project name: `app-factory-supervisor`
- Compose file: `/home/wody/docker/app-factory-supervisor/docker-compose.yml`
- Source/build context: `/home/wody/dev/app-factory-supervisor`
- App container: `app-factory-supervisor-app-1`
- Database container: `app-factory-supervisor-postgres-1`
- Published app port: `3090`
- App data volume path in container: `/app/data`
- Project workspace volume path in container: `/app/projects`

The production Compose file is intentionally outside the source tree. It currently builds from
`/home/wody/dev/app-factory-supervisor`, sets `TRUST_PROXY=true`, and sets
`SESSION_COOKIE_SECURE=true` for the HTTPS reverse-proxy deployment.

Useful production checks:

```bash
cd /home/wody/docker/app-factory-supervisor
docker compose ps
docker compose logs --tail 200 app
docker compose exec app node -e "fetch('http://127.0.0.1:3000/health').then(r=>r.text()).then(console.log)"
docker compose exec postgres psql -U app_factory -d app_factory_supervisor
```

## Current First-Run State

Last reviewed: 2026-08-10 KST.

- Admin account: configured. Current admin ID in production DB: `sia`.
- Git SSH key: configured at `/app/data/secrets/git_ssh/id_ed25519.pub`.
- Android toolchain: installed under `/app/data/toolchains`.
- Android SDK: `android-36`, build-tools `36.0.0`, platform-tools, emulator, and an AVD directory are present.
- Gradle: installed under `/app/data/toolchains/gradle-9.7.0`.
- Projects: no Android app projects have been created yet in the production DB.
- Setup wizard: still locked because the environment verification step is not marked `pass`.

Known setup issues from the 2026-08-10 review:

- Required capabilities show `50/51`; the missing row is `mcp:mobile-docs`.
- The latest failed capability install report says `docs-mcp-server --version failed`, but a direct
  production container check later returned `0.2.0`. Rerun the capability installer after rebuilding
  or restarting before treating this as a persistent package failure.
- Codex docs indexing has `16` documents and `16` unique URLs, but status is `failed` because the
  old `https://developers.openai.com/codex/internet-access` source returned HTTP 404. The current
  official URL is `https://developers.openai.com/codex/cloud/internet-access`; update and redeploy
  the app before rerunning the docs index.
- Codex worker hooks report conflicts because `/app/data/codex-home/config.toml` and
  `/app/data/codex-home/hooks.json` contain an older `app-factory-supervisor managed` marker, while
  the current ownership detector expects `APP_FACTORY_SUPERVISOR_MANAGED`. Reinstall managed hooks
  with force after confirming the existing files do not contain user-owned hook customizations.

After applying a code/config fix, rerun these setup actions from the UI or authenticated API:

- capabilities install
- Codex docs index
- managed Codex hooks install with force, if the older marker is the only conflict
- environment verification

## Deploy

1. Clone the repository.
2. Review `.env.example` and set `APP_PUBLISHED_PORT` if port `3090` is unavailable.
3. Start the stack:

```bash
docker compose up -d
```

4. Open `http://localhost:3090` or the configured host URL.
5. Complete first-run setup.

The app container owns `/app/data` and `/app/projects`. PostgreSQL owns
`/var/lib/postgresql/data`. All three are named Docker volumes.
Image rebuilds and container recreation are safe for this state as long as the named volumes are
kept. Do not run `docker compose down -v`, `docker volume rm app-factory-supervisor_*`, or
`docker volume prune` unless you have a verified backup and intend to delete the environment.

Persistent build/runtime state lives here:

- `app-factory-supervisor_app_data`: Codex home/auth/hooks, Android SDK, Gradle, AVDs, capabilities,
  secrets, artifacts, logs, docs indexes, and run scratch state under `/app/data`.
- `app-factory-supervisor_app_projects`: generated or cloned app workspaces under `/app/projects`.
- `app-factory-supervisor_postgres_data`: PostgreSQL tables for users, settings, projects, jobs,
  timelines, artifacts, setup status, and audit history.

Container-image contents such as OS packages, Java, Chromium, Codex CLI, and required MCP command
packages are baked into the image and are reproducible on rebuild. First-run downloads that are
expensive or credential-bearing stay under the named volumes above.

## First-Run Setup

The first-run wizard is complete only after these checks pass or an explicit operator action remains:

- admin account exists
- deployment/build environment installer has run
- Codex compatibility review has run
- required MCPs are installed and wired
- bundled skills and agents are copied and wired
- Android SDK, Gradle, JDK, emulator, AVD, Python, image tools, archive tools, and keystore tools are available
- generated SSH public key has been copied to the Git host

If Git access fails, add the displayed SSH public key to the Git host account and rerun the relevant
setup check.

## Project Creation

For new projects, provide the project name, app name, package name, app idea, empty repository URL,
Git name/email, max execution hours, and max worker turns. The app creates a project workspace,
initializes Git, creates or records signing material, writes `AGENTS.md`, and queues the initial
MVP/roadmap prompt.

For existing projects, provide the existing repository URL. The worker clones the repo, checks
planning documents and implementation state, then continues from the detected state.

## Export Download

Project ZIP exports are requested from the project screen. Exports include the whole project folder
and may include ignored files and `keystores/`. Only share exports with trusted recipients.

Export artifacts are stored under app data and verified by SHA-256 before download.

## Backup

Stop or quiesce the app before taking a consistent backup:

```bash
docker compose stop app
docker compose exec postgres pg_dump -U app_factory app_factory_supervisor > backup.sql
docker run --rm -v app-factory-supervisor_app_data:/data -v "$PWD:/backup" alpine tar czf /backup/app-data.tgz -C /data .
docker run --rm -v app-factory-supervisor_app_projects:/projects -v "$PWD:/backup" alpine tar czf /backup/app-projects.tgz -C /projects .
docker compose start app
```

Keep `backup.sql`, `app-data.tgz`, and `app-projects.tgz` together.

## Restore

Restore database and filesystem volumes from the same backup point:

```bash
docker compose down
# Recreate/clear volumes according to local policy before restoring.
docker compose up -d postgres
cat backup.sql | docker compose exec -T postgres psql -U app_factory app_factory_supervisor
docker run --rm -v app-factory-supervisor_app_data:/data -v "$PWD:/backup" alpine sh -c "cd /data && tar xzf /backup/app-data.tgz"
docker run --rm -v app-factory-supervisor_app_projects:/projects -v "$PWD:/backup" alpine sh -c "cd /projects && tar xzf /backup/app-projects.tgz"
docker compose up -d
```

Do not restore database rows without their artifact files.

## Maintenance

- Review Settings > Build Environment after toolchain or Codex changes.
- Review Settings > Security And Safety after changing volume mounts or proxy settings.
- Review Settings > Fail2ban Records after repeated login failures.
- Keep project exports under normal artifact retention because they may contain sensitive material.
