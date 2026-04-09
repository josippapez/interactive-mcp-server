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
- Tests: `npm test -- --run` (vitest, 185 tests)
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
- After desktop edits: run `npm test -- --run` in `desktop/` — all 185 tests must pass
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
