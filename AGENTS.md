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

- **No automatic MCP registration** — the desktop app does NOT auto-register with OpenCode on startup. Registration is manual via the "Register provider config" button in Settings.
- **Config-file timeout** — MCP tool call timeout is set in `opencode.json` via `syncRemoteConfig` at startup. Dynamic registration does not reliably override session timeouts.
- **Prompt timeout behaviour** — when a prompt times out, it clears immediately and an expiry notice is appended. No grace period.
- **SQLite via sql.js** — all session/message history is persisted in an embedded SQLite database (no native sqlite3 bindings).
- **openCodeSessionId as primary key** — after the session-ID refactor, `openCodeSessionId` is the canonical DB identity for every session. The MCP `connectionId` is an internal transport handle only. Agents must pass `openCodeSessionId` on every tool call to ensure correct channel routing.

---

## Auto-register Connection (for AI agents using interactive-desktop tools)

The desktop app **automatically registers sessions** when it detects new OpenCode sessions via SSE events. Agents do NOT need to call `register_connection` as a prerequisite — tools work immediately.

### How auto-registration works

1. When OpenCode spawns a session (root or child), the desktop app receives a `session.created.1` SSE event
2. The desktop app proactively creates a DB row for that session, keyed by `openCodeSessionId`
3. The desktop app injects a `<system-reminder>` into the agent's context containing its `openCodeSessionId` (format: `ses_<alphanumeric>`)
4. The agent can immediately use tools like `request_user_input` — just pass `openCodeSessionId` on every call

### When to call `register_connection`

Calling `register_connection` is **optional but recommended** for:

- **Custom channel names** — auto-registered channels use the OpenCode session title; call `register_connection` to set a descriptive name like "Fix authentication bug"
- **Recovering after deletion** — if a user deletes the channel from the sidebar, call `register_connection` to re-create it
- **Non-OpenCode providers** — Copilot CLI, Claude SDK, and standalone agents MUST call `register_connection` since there's no SSE auto-detection

### Why `openCodeSessionId` is required on tool calls

OpenCode uses a **shared MCP client** across all agent sessions. Without an explicit session ID on each tool call:

- Messages may route to the wrong channel in multi-agent scenarios
- Parallel subagents cannot be distinguished from each other
- The desktop app cannot reliably associate tool calls with the correct session

Each agent MUST pass `openCodeSessionId` on every tool call for correct channel routing.

### Tool Call Requirements

The following tools REQUIRE `openCodeSessionId` on every call:

| Tool                      | Purpose                                    |
| ------------------------- | ------------------------------------------ |
| `request_user_input`      | Prompt user for input/confirmation         |
| `push_session_status`     | Send non-blocking status update to UI      |
| `send_message`            | Send persistent message to channel history |
| `start_intensive_chat`    | Start multi-question chat session          |
| `ask_intensive_chat`      | Ask question in active intensive chat      |
| `stop_intensive_chat`     | Close intensive chat session               |
| `poll_context_injections` | Check for pending context from desktop app |
| `find_repo_docs`          | Search repository documentation            |

### Example workflow

**Step 1: Register connection (first tool call)**

```json
{
  "channelName": "Fix authentication bug",
  "projectName": "my-project",
  "baseDirectory": "/Users/me/projects/my-project",
  "openCodeSessionId": "ses_abc123"
}
```

**Step 2: Subsequent tool calls (always include openCodeSessionId)**

```json
// request_user_input
{
  "projectName": "my-project",
  "message": "Should I refactor the auth module?",
  "baseDirectory": "/Users/me/projects/my-project",
  "openCodeSessionId": "ses_abc123"
}

// push_session_status
{
  "status": "Running tests...",
  "type": "working",
  "openCodeSessionId": "ses_abc123"
}

// send_message
{
  "message": "Build completed successfully.",
  "openCodeSessionId": "ses_abc123"
}
```

---

## Prompt-Loop Policy (for AI agents using interactive-mcp tools)

When calling `request_user_input` or `ask_intensive_chat`:

- If the tool returns `"User did not reply: Timeout occurred."` — call the tool **again immediately**. Never emit a plain-text-only reply after a timeout.
- Continue prompting until the user sends one of the exact stop phrases: `Stop prompting`, `End session`, `Don't ask anymore`, `Close conversation`.

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
