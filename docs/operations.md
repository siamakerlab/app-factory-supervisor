# Operations Runbook

This runbook covers day-to-day operation for the single-user Docker Compose deployment.

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
