# Interactive MCP Server — Agent Guidelines

## Project Overview

This repository contains two distinct packages:

| Package                   | Location      | Purpose                                |
| ------------------------- | ------------- | -------------------------------------- |
| `@rawwee/interactive-mcp` | `src/` (root) | CLI/TUI-based MCP server (npm package) |
| `interactive-mcp-desktop` | `desktop/`    | Electron desktop app (GUI MCP server)  |

The CLI package (`src/`) is published to npm. The desktop app (`desktop/`) is distributed as a standalone Electron binary. They share tool definitions conceptually but have separate codebases.

---

## Architecture

### CLI Package (`src/`)

- Entry: `src/index.ts`
- Tool definitions: `src/tool-definitions/`
- Build: `tsc --outDir dist && tsc-alias`
- No test suite — type-check with `npm run check-types`
- Published via semantic-release on merge to `main`

### Desktop App (`desktop/`)

- Entry: `desktop/src/main/index.ts`
- Main process tools: `desktop/src/main/tools/`
- Build: `electron-vite build`
- Tests: `npm test -- --run` (vitest, 427 tests)
- Packaging: `npm run package:mac` / `package:win` / `package:linux`
- Docs: `desktop/docs/` — authoritative architecture and API references

---

## Development Rules

### Package Manager

- Root package uses **npm** (`npm install`, `npm run build`)
- Desktop package uses **npm** (`npm install`, `npm run build`)
- Do NOT use `yarn` or `pnpm`

### Running

- **NEVER** attempt to start the desktop Electron app during development — build artifacts exist in `desktop/out/`
- The CLI package can be tested with `node dist/index.js` after building
- Use `npm run dev` in `desktop/` for local development with hot-reload

### Code Quality

- TypeScript throughout — no `any` types
- All new code must pass: `npm run check-types` (root) and type-checking in `desktop/`
- After desktop edits: run `npm test -- --run` in `desktop/` — all 427 tests must pass
- After root edits: run `npm run check-types`

### File Structure

- Tool descriptions live in TWO places and must be kept in sync:
  - `src/tool-definitions/<tool>.ts` — used by CLI package when registering with MCP clients
  - `desktop/src/main/tools/<tool>.ts` — used by Electron app's MCP server
- The `<importantNotes>` blocks in tool descriptions are agent-facing instructions — edit carefully

---

## Key Architectural Decisions

- **Automatic OpenCode session registration** — the desktop app registers OpenCode sessions from SDK/SSE session events. Agents do NOT call `register_connection` for OpenCode-backed sessions.
- **Config-file timeout** — MCP tool call timeout is set in `opencode.json` via `syncRemoteConfig` at startup. Dynamic registration does not reliably override session timeouts.
- **Prompt timeout behaviour** — when a prompt times out, it clears immediately and an expiry notice is appended. No grace period.
- **SQLite via sql.js** — all session/message history is persisted in an embedded SQLite database (no native sqlite3 bindings).
- **providerSessionId as primary key** — after the provider-session-id unification refactor (Phase 6), `providerSessionId` is the canonical DB identity for every session, paired with `providerType` as a composite primary key `(providerType, providerSessionId)`. For OpenCode sessions, `providerSessionId` equals the OpenCode session ID. The MCP `connectionId` is an internal transport handle only. Agents pass `openCodeSessionId` on the MCP wire (kept for agent-facing compatibility); it is mapped to `providerSessionId` internally at the MCP boundary. Agents must pass `openCodeSessionId` on every tool call to ensure correct channel routing.

---

## Auto-register Connection (for AI agents using desktop repo docs/libs tools)

The desktop app **automatically registers sessions** when it detects new OpenCode sessions via SDK/SSE events. Agents do NOT call `register_connection` as a prerequisite — repo docs/libs tools work from the auto-registered session metadata.

### How auto-registration works

1. When OpenCode spawns a session (root or child), the desktop app receives a `session.created.1` SSE event
2. The desktop app proactively creates a DB row for that session, keyed by `openCodeSessionId`
3. The desktop app injects a `<system-reminder>` into the agent's context containing its `openCodeSessionId` (format: `ses_<alphanumeric>`) and the exposed repo docs/libs tool list
4. The agent can immediately use repo docs/libs tools when a session base directory is available

### Why `openCodeSessionId` is required on tool calls

OpenCode uses a **shared MCP client** across all agent sessions. Without an explicit session ID on each tool call:

- Messages may route to the wrong channel in multi-agent scenarios
- Parallel subagents cannot be distinguished from each other
- The desktop app cannot reliably associate tool calls with the correct session

Each agent MUST pass `openCodeSessionId` to repo docs/libs tools that include that parameter for correct channel routing.

### Tool Call Requirements

The advertised desktop MCP surface is repository context only:

| Tool             | Purpose                                       |
| ---------------- | --------------------------------------------- |
| `find_docs`      | Search repository documentation               |
| `find_repo_docs` | Backward-compatible alias for `find_docs`     |
| `list_docs`      | List available repository documentation paths |
| `read_doc`       | Read one repository documentation file        |
| `find_libs`      | Find npm libraries from package manifests     |

### Example workflow

**Search repository docs**

```json
{
  "query": "session registration bootstrap",
  "limit": 8,
  "openCodeSessionId": "ses_abc123"
}
```

---

## Prompt-Loop Policy (for AI agents working in this repository)

Agents MUST use the **built-in questions tool** (the harness-provided `question` / `ask_question` / equivalent) for all user-facing prompts. Interactive MCP prompt tools (`request_user_input`, `ask_intensive_chat`, `start_intensive_chat`, `stop_intensive_chat`, `push_session_status`, `send_message`) are NOT the prompt path for in-repo agent work and MUST NOT be used here.

> Note: The MCP tool implementations still exist in `desktop/src/main/tools/` for external consumers of the desktop app. The above rule governs only the agents editing this repository.

When prompting via the built-in questions tool:

- If a prompt returns an empty response or error, re-prompt immediately with a shorter, option-driven question. Do not fall back to plain-text completion.
- Continue prompting until the user sends one of the exact stop phrases: `Stop prompting`, `End session`, `Don't ask anymore`, `Close conversation`.
- After every task delivery, run the mandatory satisfaction check: `Are you satisfied with this result, or would you like any changes?`

See `docs/guides/prompting-tool-selection.md` for the full policy.

---

## Testing

```sh
# Desktop tests (must all pass before any PR):
cd desktop && npm test -- --run

# Root type-check:
npm run check-types

# Desktop build verification:
cd desktop && npm run build
```

---

## Common Pitfalls

- Do NOT add `useEffect` or other hooks after an early return in React components — React will throw a hooks-order error.
- Do NOT use `useMemo` for side effects (setter calls, singleton updates) — use `useEffect` instead.
- Do NOT read or write `.env` files — use process environment variables or the settings store.
- Do NOT call `npm audit fix` or `npm audit fix --force` — these only patch `package-lock.json` temporarily.

---

## React: `useEffect` Discipline

**Default: avoid `useEffect`.** Before adding one, justify it against this checklist:

1. **Can this be derived during render?** → use inline computation or `useMemo`. Do not sync props-to-state with an effect.
2. **Is it triggered by a user action?** → put it in an event handler, not an effect.
3. **Do I just need the latest value of something inside a callback?** → ref + getter (`ref.current`), not `useEffect` with a deps array.
4. **Is it a genuine subscription to an external system** (Electron IPC, DOM event, timer, WebSocket, SSE) whose lifecycle matches the component's? → `useEffect` with **empty `[]` deps** is acceptable. Access latest values via a ref updated on every render, not via the deps array.
5. **Am I using it to keep two pieces of state in sync?** → it is almost always wrong. Lift, derive, or use a `key` prop reset.

**Sprawling deps arrays are a code smell.** If an effect has 5+ callback deps and any one of them is recreated on parent re-render, the effect thrashes (cleanup → re-register → setState → parent re-render → loop). This has caused 100%+ renderer CPU regressions in this repo. Fix with `optsRef.current` + `[]` deps.

When an effect is the right tool, keep it narrowly scoped: one subscription, explicit disposer, empty deps where possible.

---

## ForgeCode Skills

Project skills live in `.forge/skills/` and are automatically loaded by ForgeCode:

| Skill                     | Trigger                                      |
| ------------------------- | -------------------------------------------- |
| `add-tool`                | Adding a new MCP tool to the server          |
| `update-tool-description` | Editing agent-facing tool descriptions       |
| `run-tests`               | Verifying changes — tests, type-check, build |
| `package-desktop`         | Building a distributable installer           |

> **Note on `.forge.toml`**: This is a global config file (`~/.forge/.forge.toml`) — it is machine-specific and not committed to the repo. Edit it with `:config-edit` inside a ForgeCode session.

---

## References

- Architecture: `desktop/docs/ARCHITECTURE.md`
- Tool API reference: `desktop/docs/TOOLS.md`
- Settings config: `desktop/docs/SETTINGS-CONFIG.md`
- MCP server internals: `desktop/docs/MCP-SERVER.md`
- Build & packaging: `desktop/docs/BUILD-PACKAGING.md`
- IPC API: `desktop/docs/IPC-API.md`
