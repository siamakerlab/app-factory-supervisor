# Capability Installer

Phase 12 wires the default MCP, skill, and agent inventory for Android/Kotlin worker runs.

The installer separates capabilities by source and setup stage:

- Required MCPs are installed and wired during the first-run wizard.
- Product-owned Android skills and review agents are bundled in the image and copied into persistent capability directories on first run.
- Optional credentialed MCPs remain disabled until credentials exist.
- Optional advanced MCPs are inventoried but not enabled by default.

Default exclusions:

- App Factory Autopilot defaults are not installed.
- Sequential Thinking MCP is not installed by default.
- Review skills with App Factory-like names are treated only as product-owned bundled copies or explicit repository dependencies.

Runtime paths:

- Capability root: `/app/data/capabilities`
- Worker skills: `/app/data/capabilities/skills`
- Worker agents: `/app/data/capabilities/agents`
- App-managed Codex config: `/app/data/codex/config.toml`

The app writes only the section between these markers:

```toml
# >>> app-factory-supervisor managed capabilities
# <<< app-factory-supervisor managed capabilities
```

If the start marker exists without the end marker, the installer fails closed and reports a config ownership conflict. User-managed sections outside the markers are preserved.

The capability installer records:

- package id and type
- source type
- source URL when known
- wired target
- required/optional state
- install stage
- status
- verification timestamp
- install report artifact

The supervisor never invokes these capabilities directly. It may only instruct the worker to use them.
