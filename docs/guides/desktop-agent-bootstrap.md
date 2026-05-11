# Desktop Agent Bootstrap

This guide owns the agent-facing bootstrap message that the desktop app injects into OpenCode sessions.

## Current contract

- OpenCode sessions are registered automatically from SDK/SSE session events.
- Agents do **not** call `register_connection` as a prerequisite.
- The advertised desktop MCP surface is repository context plus skills/instructions catalog management:
  - `find_docs`
  - `find_repo_docs` (compatibility alias)
  - `list_docs`
  - `read_doc`
  - `find_libs` (searches the root `package.json` package names in `dependencies`/`devDependencies`; it does not query external registries or inspect nested manifests)
  - `manage_skills_and_instructions`
- Interactive prompt/channel tools are not part of the exposed agent workflow.
- For OpenCode-backed sessions, repo docs/libs tools may still require `openCodeSessionId` for routing because OpenCode shares one MCP client across sessions.

## Bootstrap message requirements

The injected `<system-reminder>` must:

1. Say that the session was auto-registered by the desktop app.
2. Include the OpenCode session ID when known.
3. Tell agents to pass `openCodeSessionId` only to repo docs/libs tools that accept it.
4. List only the exposed repo docs/libs and skills/instructions catalog-management tools.
5. Avoid instructions to call `register_connection`.
6. Avoid references to `request_user_input`, intensive chat, status push, `send_message`, or other hidden/removed interactive tools.

## Files that should stay aligned

- `desktop/src/main/utility/backend/startup-context.ts`
- `desktop/src/main/utility/backend/auto-register.ts`
- `desktop/src/main/utility/backend/tools/find-repo-docs.ts`
- `AGENTS.md`
