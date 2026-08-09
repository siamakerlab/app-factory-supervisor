# Codex Documentation Index

The running app generates the authoritative documentation index report at
`/app/data/artifacts/codex-doc-index.md`.

## Current Implementation

- The index name is `openai-codex`.
- The store path defaults to `/app/data/mobile-docs`.
- Indexing runs through `docs-mcp-server scrape` for official Codex documentation URLs.
- The smoke query is `codex exec --json output-schema hooks MCP`.
- Setup/build readiness must remain blocked while the index is missing, failed, or not queryable.
- Compatibility reviews link to the latest ready `openai-codex` index through
  `codex_compatibility_reviews.codex_doc_index_id`.

## Official OpenAI Documentation Basis

- MCP servers should expose search/fetch-style document tools with structured results:
  `https://developers.openai.com/api/docs/mcp`
- Codex CLI: `https://developers.openai.com/codex/cli`
- Non-interactive mode: `https://developers.openai.com/codex/non-interactive-mode`
- Developer commands: `https://developers.openai.com/codex/developer-commands`
- MCP configuration: `https://developers.openai.com/codex/mcp`
- Hooks: `https://developers.openai.com/codex/hooks`
- App Server: `https://developers.openai.com/codex/app-server`
- AGENTS.md: `https://developers.openai.com/codex/agent-configuration/agents-md`

## Runtime Expectation

If `docs-mcp-server` is not installed in the app container, indexing records `failed` with a gap
report instead of marking Build Environment ready.
