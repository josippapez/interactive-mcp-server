---
applyTo: '**'
name: read-docs-instructions
description: Instructions for reading documentation to assist with tasks.
---

Follow this deterministic order when documentation is needed:

1. Check local repo docs first under `/docs` (guides + standards).
2. If external package behavior is relevant and no authoritative local doc exists, use `context7`.
3. If the task involves TanStack libraries, use the TanStack CLI docs approach.

Hard requirements:

- When using external docs, prefer version-specific documentation based on `package.json` or explicit user-provided version.
- If user provides a documentation link, treat that link as primary source.
- If code changes invalidate existing docs, update the corresponding `/docs` pages in the same task.
- In summaries/PR notes, call out assumptions when exact versions are uncertain.

TanStack requirement:

Use npx @tanstack/cli to look up TanStack documentation. Always pass --json for machine-readable output.

# List TanStack libraries (optionally filter by --group state|headlessUI|performance|tooling)

npx @tanstack/cli libraries --json

# Fetch a specific doc page

npx @tanstack/cli doc query framework/react/overview --docs-version v5 --json

# Search docs (optionally filter by --library, --framework, --limit)

npx @tanstack/cli search-docs "server functions" --library start --json
npx @tanstack/cli search-docs "loaders" --library router --framework react --json
