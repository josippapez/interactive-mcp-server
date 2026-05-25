# Desktop Agent Bootstrap

This guide owns the agent-facing bootstrap message that the desktop app injects into OpenCode sessions.

## Current contract

- The bootstrap message is a minimal `<system-reminder>` that directly injects available DB-stored skills, catalog instructions, always-mode instruction content, and memories.
- It does not describe desktop registration mechanics, session identity, project metadata, base directory, exposed tool lists, or prompt-tool policy.
- Skills and catalog-mode instructions are advertised by name and description only; agents fetch full content on demand with `manage_skills_and_instructions`.
- Always-mode instructions and memories are injected inline with XML escaping.
- Empty skills/instructions/memories sections are not emitted.

## Bootstrap message requirements

The injected `<system-reminder>` must:

1. Start with `<system-reminder>` and end with `</system-reminder>`.
2. Include `<available_skills source="db">` only when enabled, in-scope skills exist.
3. Include `<available_instructions source="db">` only when enabled, in-scope catalog-mode instructions exist.
4. Include `<instructions source="db">` only when enabled, in-scope always-mode instructions exist.
5. Include `<memories source="db">` only when memories exist for the session.
6. Preserve XML escaping for injected names, descriptions, content, memory project paths, and memory content.
7. Include on-demand retrieval notes only when skills or catalog-mode instructions are present.
8. Avoid operational metadata such as registered agent, project, base directory, OpenCode session ID, auto-registration explanation, exposed MCP tool list, and prompt-tool policy.

## Files that should stay aligned

- `desktop/src/main/utility/backend/startup-context.ts`
- `desktop/src/main/utility/backend/auto-register.ts`
- `desktop/src/main/utility/backend/tools/find-repo-docs.ts`
- `AGENTS.md`
