---
name: add-custom-agent-or-tool
description: Add either a new MCP tool on the main process or a new OpenCode custom agent definition. Covers both directions — which path to take, and how to wire it through.
when_to_use:
  - Adding a new MCP tool the desktop server exposes to connected agents (e.g. a new capability alongside request_user_input).
  - Creating or editing an OpenCode custom agent markdown file (global or project scope).
  - Changing how agents are discovered, listed, or persisted.
---

# Skill: add-custom-agent-or-tool

Covers two related but distinct tasks:

- **Path A** — Adding a new MCP tool on the desktop's main-process MCP server.
- **Path B** — Adding or editing an OpenCode custom agent markdown file.

Pair with: [`desktop/docs/PATTERNS.md §5`](../../desktop/docs/PATTERNS.md#5-custom-agents--opencode-config-pattern),
[`desktop/docs/MCP-SERVER.md`](../../desktop/docs/MCP-SERVER.md),
[`desktop/docs/TOOLS.md`](../../desktop/docs/TOOLS.md).

Decide which path applies before starting:

- If agents connected via MCP should be able to **call a new capability**,
  take Path A.
- If you want OpenCode to have a **new selectable agent persona** (like
  `docs-maintainer` or `build`), take Path B.

---

## Path A — Add a new MCP tool

### Critical rules

1. **Every tool requires a matching agent-facing description.** The agent
   reads the `description` block at call-time. Edit descriptions carefully —
   they are part of the public API of this app.
2. **Keep tool definitions in sync across packages.** The CLI package at
   repo-root `src/tool-definitions/<tool>.ts` and the desktop app at
   `desktop/src/main/tools/<tool>.ts` both describe the same tools. If you
   change one, change the other (see root `AGENTS.md`).
3. **Session routing.** Tools that produce UI (prompts, status updates,
   messages) must accept an explicit `openCodeSessionId` parameter and use
   it for channel routing. Never rely on the shared MCP connection handle
   alone.
4. **Pure handler, registered via the MCP SDK.** Tool files export a
   register function that binds the handler to the `McpServer` instance.

### Steps

1. Create `desktop/src/main/tools/<tool-name>.ts`. Follow the shape of
   existing tools in the same directory — they export a register function
   that takes the `McpServer` and a dependencies bag.
2. Import and call the register function from `desktop/src/main/mcp-server.ts`
   where existing tools are wired.
3. Mirror the tool's `description` block in the CLI package at
   `src/tool-definitions/<tool-name>.ts` (repo root, not `desktop/`).
4. Add unit tests:
   - For pure helpers the tool uses — co-located `.test.ts`.
   - For tool registration itself — extend `mcp-server.test.ts` or a
     tool-specific test next to the tool file.
5. Validate:

   ```sh
   cd desktop
   npm test -- --run
   npm run build
   cd ..
   npm run check-types   # root package type-check (CLI side)
   ```

### Anti-patterns

- Adding a tool without matching agent-facing description updates in the
  CLI package — agents will see inconsistent behaviour between the two
  distributions.
- Omitting `openCodeSessionId` — in multi-agent scenarios messages will
  route to the wrong channel.
- Hard-coding copy that should live in the `<importantNotes>` block of the
  tool description.

---

## Path B — Add an OpenCode custom agent

Agent markdown files are discovered by `src/main/opencode/agents.ts` and
exposed through the `listAgents` / `readAgent` / `writeAgent` / `deleteAgent`
IPC handlers. They appear in the Settings → Agents section.

### Critical rules

1. **Two scopes: global and project.** Global agents live under
   `~/.config/opencode/agent/*.md`. Project agents live under
   `<baseDirectory>/.opencode/agent/*.md`. A project-scoped agent shadows a
   global one of the same name (UI shows `overridden: true`).
2. **Frontmatter schema.** `description`, `mode`, `model`, `tools` — the
   body is free-form markdown. Missing fields get sensible defaults; see
   `src/main/opencode/agents.ts` top-of-file comment.
3. **Preserve managed entries in OpenCode config.** If the change also
   touches `opencode.json` (e.g. to register the agent as a default), the
   `mcp["interactive-desktop"]` subtree is managed by `config-sync.ts` and
   must round-trip unchanged.

### Steps

1. Decide scope:
   - Global (shared across all projects) → `~/.config/opencode/agent/<name>.md`
   - Project (specific to one repo) → `<baseDirectory>/.opencode/agent/<name>.md`
2. Create the file with frontmatter:

   ```md
   ---
   description: One-line summary of what this agent does.
   mode: subagent
   model: anthropic/claude-sonnet-4.5
   tools:
     write: false
     edit: true
     bash: false
   ---

   # Agent body

   Free-form markdown instructions for the agent.
   ```

3. Reload the Settings → Agents view in the desktop app (or call
   `window.api.listAgents(baseDirectory)`) to verify discovery.
4. To modify an existing agent programmatically, use `writeAgent` via the
   preload endpoint (`src/preload/api/agents.ts`).

### Anti-patterns

- Writing an agent file with unknown top-level frontmatter keys — they are
  preserved but ignored; prefer sticking to the documented schema.
- Editing OpenCode config to register an agent and clobbering the
  `mcp["interactive-desktop"]` entry — read-modify-write only the keys you
  own.
- Hand-rolling the markdown format — when possible, go through `writeAgent`
  so the file is normalised.

---

## Reference files

- MCP server: `desktop/src/main/mcp-server.ts`
- Tools directory: `desktop/src/main/tools/`
- Agents source: `desktop/src/main/opencode/agents.ts`
- Agents preload API: `desktop/src/preload/api/agents.ts`
- Config sync: `desktop/src/main/opencode/config-sync.ts`
- CLI tool definitions: `src/tool-definitions/` (repo root)
- Pattern doc: `desktop/docs/PATTERNS.md`
