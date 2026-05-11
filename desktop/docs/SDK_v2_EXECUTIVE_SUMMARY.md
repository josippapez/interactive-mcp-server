# @opencode-ai/sdk v2 — Executive Summary

**Date**: May 2026  
**SDK Version**: v2 (from `desktop/node_modules/@opencode-ai/sdk`)  
**Status**: ✅ Ready for desktop integration

---

## Quick Facts

| Metric                    | Value                                                                         |
| ------------------------- | ----------------------------------------------------------------------------- |
| **Total Namespaces**      | 25                                                                            |
| **Total Methods**         | 150+                                                                          |
| **Core Namespaces**       | 3 (session, config, mcp, event)                                               |
| **Secondary Namespaces**  | 8 (file, find, permission, project, vcs, pty, question, tui)                  |
| **Utility Namespaces**    | 14 (auth, auth2, provider, part, sync, tool, worktree, app, global, etc.)     |
| **SSE Streaming Methods** | 4 (session.prompt, session.command, session.shell, global.event)              |
| **Desktop-Specific Gaps** | 9 (IPC, window, persistence, settings, tray, updater, mode, file.write, etc.) |

---

## What SDK v2 Provides

### ✅ Session Management (24 methods)

- Create, list, get, delete, update sessions
- Send prompts (streaming SSE)
- Send commands and shell commands
- Fork, abort, revert, share sessions
- Fetch messages, diffs, todos
- Initialize sessions with AGENTS.md

**Desktop Impact**: Replace custom session discovery and message fetching with SDK calls.

### ✅ Configuration (3 methods)

- Get project configuration
- Update configuration
- List configuration providers

**Desktop Impact**: Replace custom config parsing with SDK calls. **Caveat**: `update()` does NOT preserve JSONC comments.

### ✅ MCP Management (4 methods)

- Get MCP server status
- Add new MCP servers
- Connect/disconnect MCP servers

**Desktop Impact**: Replace custom MCP registry with SDK calls. **Gap**: No `remove()` method.

### ✅ File & Search (6 methods)

- List files
- Read file content
- Get file status
- Search files, text, symbols

**Desktop Impact**: Replace custom file/search operations with SDK calls. **Gap**: No `file.write()` method.

### ✅ Permission & Auth (9 methods)

- List permissions
- Reply/respond to permissions
- Set/remove auth credentials
- OAuth flow (start, callback, authenticate)

**Desktop Impact**: Integrate SDK permission handling with IPC flow.

### ✅ Real-Time Events (SSE)

- Subscribe to events (session, message, permission, question, tui, etc.)
- Stream responses from prompts, commands, shell

**Desktop Impact**: Replace custom event polling with SDK SSE streams.

### ✅ Additional Namespaces

- **Project**: current, list, initGit, update
- **VCS**: get, diff
- **PTY**: shells, list, create, remove, get, update, connect
- **Question**: list, reply, reject
- **TUI**: appendPrompt, openHelp, openSessions, showToast, etc.
- **Worktree**: list, create, remove, reset
- **App**: log, agents, skills
- **Global**: health, event, dispose, upgrade

---

## What SDK v2 Does NOT Provide

### ❌ Desktop-Specific Features

- **IPC handlers** (Electron main ↔ renderer communication)
- **Window management** (create, focus, close windows)
- **SQLite persistence** (session history, caching)
- **Settings store** (user preferences)
- **System tray** (tray icon, menu)
- **Auto-updater** (check, download, install updates)

**Reason**: These are Electron-specific and outside the scope of the OpenCode SDK.

### ❌ SDK Limitations

- **No JSONC preservation** in `config.update()` — comments are lost
- **No mode namespace** — use SSE events to detect mode changes
- **No file.write()** — use `session.shell()` or direct file system access
- **No project/workspace deletion** — manual cleanup required
- **No question/permission creation** — server-initiated only
- **No MCP remove()** — use `disconnect()` + manual config cleanup

---

## Migration Strategy

### Phase 1: Core (Weeks 1-2)

- Wrap `session.*` and `config.*` calls
- Sync to SQLite for offline access
- Update IPC handlers

### Phase 2: Messages (Weeks 2-3)

- Wrap `session.messages()` and `session.prompt()` (SSE)
- Stream SSE responses to renderer
- Sync messages to SQLite

### Phase 3: MCP & Permissions (Weeks 3-4)

- Wrap `mcp.*` and `permission.*` calls
- Integrate with IPC permission flow

### Phase 4: File & Search (Weeks 4-5)

- Wrap `file.*` and `find.*` calls
- Replace custom search logic

### Phase 5: Events (Weeks 5-6)

- Wrap `event.subscribe()` (SSE)
- Stream events to renderer

### Phase 6: Cleanup (Weeks 6-7)

- Remove redundant custom code
- Optimize caching layer
- Full test suite validation

---

## High-Value Migrations (Tier 1)

| Module             | SDK Call                        | Effort | Impact      |
| ------------------ | ------------------------------- | ------ | ----------- |
| Session manager    | `client.session.*`              | Low    | ⭐⭐⭐ High |
| Message fetcher    | `client.session.messages()`     | Low    | ⭐⭐⭐ High |
| Prompt sender      | `client.session.prompt()` (SSE) | Medium | ⭐⭐⭐ High |
| Config manager     | `client.config.get()`           | Low    | ⭐⭐⭐ High |
| MCP registry       | `client.mcp.*`                  | Low    | ⭐⭐⭐ High |
| Permission handler | `client.permission.*`           | Low    | ⭐⭐ Medium |
| File operations    | `client.file.*`                 | Low    | ⭐⭐ Medium |
| Search operations  | `client.find.*`                 | Low    | ⭐⭐ Medium |

---

## Risk Assessment

### High Risk

- **SSE streaming**: Ensure stream cleanup on disconnect
- **Config updates**: Preserve JSONC comments manually
- **Permission flow**: Ensure IPC integration doesn't break

### Medium Risk

- **MCP lifecycle**: Ensure connect/disconnect state is consistent
- **Message sync**: Ensure SQLite cache stays in sync
- **Event ordering**: Ensure events are processed in order

### Low Risk

- **File operations**: Read-only; no state changes
- **Search operations**: Read-only; no state changes
- **Project info**: Read-only; no state changes

---

## Success Criteria

- ✅ All SDK calls wrapped and tested
- ✅ IPC handlers call SDK wrappers
- ✅ SSE streams work end-to-end
- ✅ SQLite cache stays in sync
- ✅ No performance regression
- ✅ All 427 tests pass
- ✅ Desktop app starts and runs normally

---

## Key Takeaways

1. **SDK v2 is production-ready** for desktop integration
2. **150+ methods** cover session, config, MCP, file, search, permission, auth, and event operations
3. **25 namespaces** provide comprehensive OpenCode API coverage
4. **SSE streaming** enables real-time response delivery
5. **Desktop-specific features** (IPC, window, persistence) must remain custom
6. **JSONC preservation** requires manual handling
7. **6-7 week migration** plan with phased rollout
8. **High-value migrations** (session, config, MCP) should be prioritized

---

## Next Steps

1. **Review** `SDK_v2_COMPLETE_CAPABILITY_MAP.md` for detailed method signatures
2. **Review** `SDK_v2_MIGRATION_MATRIX.md` for tier-based migration roadmap
3. **Start Phase 1** with session and config wrapping
4. **Validate** with existing test suite (427 tests)
5. **Iterate** through phases 2-6 with regular validation

---

## References

- **Complete Capability Map**: `desktop/docs/SDK_v2_COMPLETE_CAPABILITY_MAP.md`
- **Migration Matrix**: `desktop/docs/SDK_v2_MIGRATION_MATRIX.md`
- **Method Signatures**: `desktop/docs/SDK_v2_METHOD_SIGNATURES.md`
- **Quick Reference**: `desktop/docs/SDK_v2_QUICK_REFERENCE.md`
- **SDK Source**: `desktop/node_modules/@opencode-ai/sdk/dist/v2/`
