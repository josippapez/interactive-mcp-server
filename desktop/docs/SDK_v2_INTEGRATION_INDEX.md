# @opencode-ai/sdk v2 — Integration Index

**Purpose**: Central reference for all SDK v2 documentation and integration resources.

**Date**: May 2026  
**Status**: ✅ Complete capability map generated

---

## 📚 Documentation Map

### Executive Level

- **[SDK_v2_EXECUTIVE_SUMMARY.md](SDK_v2_EXECUTIVE_SUMMARY.md)** — High-level overview, quick facts, key takeaways
  - 25 namespaces, 150+ methods
  - 3 core namespaces (session, config, mcp)
  - 9 desktop-specific gaps
  - 6-7 week migration plan

### Detailed Reference

- **[SDK_v2_COMPLETE_CAPABILITY_MAP.md](SDK_v2_COMPLETE_CAPABILITY_MAP.md)** — Authoritative full reference
  - All 25 namespaces with method signatures
  - Detailed parameter documentation
  - Return types and side-effects
  - Notable gaps and caveats
  - Event stream (SSE) topics

- **[SDK_v2_CRITICAL_SIGNATURES.md](SDK_v2_CRITICAL_SIGNATURES.md)** — Exact TypeScript signatures
  - Session namespace (24 methods)
  - Config namespace (3 methods)
  - Mcp namespace (4 methods)
  - Event namespace (1 method - SSE)
  - Global namespace (4 methods)
  - Usage examples and error handling

### Migration Planning

- **[SDK_v2_MIGRATION_MATRIX.md](SDK_v2_MIGRATION_MATRIX.md)** — Tier-based migration roadmap
  - Tier 1: High-value migrations (8 modules)
  - Tier 2: Medium-value migrations (6 modules)
  - Tier 3: Low-value migrations (keep custom)
  - 6-phase implementation plan
  - Risk assessment and success criteria

### Quick Reference

- **[SDK_v2_QUICK_REFERENCE.md](SDK_v2_QUICK_REFERENCE.md)** — TL;DR summary
  - 40 namespaces at a glance
  - Method counts per namespace
  - Desktop relevance ratings

### Historical Reference

- **[SDK_v2_METHOD_SIGNATURES.md](SDK_v2_METHOD_SIGNATURES.md)** — Complete method signatures (legacy)
- **[SDK_v2_INDEX.md](SDK_v2_INDEX.md)** — Namespace index (legacy)

---

## 🎯 Quick Navigation

### By Use Case

**I want to...**

- **Understand what SDK v2 provides** → Read [EXECUTIVE_SUMMARY.md](SDK_v2_EXECUTIVE_SUMMARY.md)
- **See all available methods** → Read [COMPLETE_CAPABILITY_MAP.md](SDK_v2_COMPLETE_CAPABILITY_MAP.md)
- **Get exact TypeScript signatures** → Read [CRITICAL_SIGNATURES.md](SDK_v2_CRITICAL_SIGNATURES.md)
- **Plan a migration** → Read [MIGRATION_MATRIX.md](SDK_v2_MIGRATION_MATRIX.md)
- **Quick lookup** → Read [QUICK_REFERENCE.md](SDK_v2_QUICK_REFERENCE.md)

### By Namespace

**Session Management**

- Methods: 24 (list, create, get, delete, update, prompt, command, shell, fork, abort, revert, share, etc.)
- Streaming: `prompt()`, `command()`, `shell()` return SSE streams
- See: [CRITICAL_SIGNATURES.md#session-namespace](SDK_v2_CRITICAL_SIGNATURES.md#session-namespace-24-methods)

**Configuration**

- Methods: 3 (get, update, providers)
- Caveat: `update()` does NOT preserve JSONC comments
- See: [CRITICAL_SIGNATURES.md#config-namespace](SDK_v2_CRITICAL_SIGNATURES.md#config-namespace-3-methods)

**MCP Management**

- Methods: 4 (status, add, connect, disconnect)
- Gap: No `remove()` method
- See: [CRITICAL_SIGNATURES.md#mcp-namespace](SDK_v2_CRITICAL_SIGNATURES.md#mcp-namespace-4-methods)

**File & Search**

- Methods: 6 (file.list, file.read, file.status, find.files, find.text, find.symbols)
- Gap: No `file.write()` method
- See: [COMPLETE_CAPABILITY_MAP.md#file-3-methods](SDK_v2_COMPLETE_CAPABILITY_MAP.md#file-3-methods-)

**Permission & Auth**

- Methods: 9 (permission.list, permission.reply, permission.respond, auth.set, auth.remove, auth2.start, auth2.callback, auth2.authenticate, auth2.remove)
- See: [COMPLETE_CAPABILITY_MAP.md#permission-3-methods](SDK_v2_COMPLETE_CAPABILITY_MAP.md#permission-3-methods-)

**Events (SSE Streaming)**

- Methods: 1 (event.subscribe)
- Streaming: Returns async iterable of events
- Topics: session._, message._, permission._, question._, tui.\*
- See: [CRITICAL_SIGNATURES.md#event-namespace-1-method---sse-streaming](SDK_v2_CRITICAL_SIGNATURES.md#event-namespace-1-method---sse-streaming)

**Project & VCS**

- Methods: 6 (project.current, project.list, project.initGit, project.update, vcs.get, vcs.diff)
- See: [COMPLETE_CAPABILITY_MAP.md#project-4-methods](SDK_v2_COMPLETE_CAPABILITY_MAP.md#project-4-methods-)

**PTY & Shell**

- Methods: 8 (pty.shells, pty.list, pty.create, pty.remove, pty.get, pty.update, pty.connectToken, pty.connect)
- See: [COMPLETE_CAPABILITY_MAP.md#pty-8-methods](SDK_v2_COMPLETE_CAPABILITY_MAP.md#pty-8-methods-)

**Question & TUI**

- Methods: 14 (question.list, question.reply, question.reject, tui.appendPrompt, tui.openHelp, tui.openSessions, tui.showToast, etc.)
- See: [COMPLETE_CAPABILITY_MAP.md#question-3-methods](SDK_v2_COMPLETE_CAPABILITY_MAP.md#question-3-methods-) and [COMPLETE_CAPABILITY_MAP.md#tui-11-methods](SDK_v2_COMPLETE_CAPABILITY_MAP.md#tui-11-methods-)

**Utility Namespaces**

- App (3 methods): log, agents, skills
- Global (4 methods): health, event, dispose, upgrade
- Tool (2 methods): list, ids
- Worktree (4 methods): list, create, remove, reset
- Part (2 methods): delete, update
- Sync (3 methods): start, replay, steal
- Provider (2 methods): list, auth
- Command (1 method): list
- Lsp (1 method): status
- Formatter (1 method): status
- Path (1 method): get
- See: [COMPLETE_CAPABILITY_MAP.md#detailed-namespace-reference](SDK_v2_COMPLETE_CAPABILITY_MAP.md#detailed-namespace-reference)

---

## 🚀 Getting Started

### Step 1: Review Executive Summary

Read [SDK_v2_EXECUTIVE_SUMMARY.md](SDK_v2_EXECUTIVE_SUMMARY.md) to understand:

- What SDK v2 provides (150+ methods across 25 namespaces)
- What it doesn't provide (desktop-specific features)
- High-level migration strategy

### Step 2: Review Critical Signatures

Read [SDK_v2_CRITICAL_SIGNATURES.md](SDK_v2_CRITICAL_SIGNATURES.md) to understand:

- Exact TypeScript signatures for core namespaces
- SSE streaming patterns
- Error handling

### Step 3: Review Migration Matrix

Read [SDK_v2_MIGRATION_MATRIX.md](SDK_v2_MIGRATION_MATRIX.md) to understand:

- Tier-based migration priorities
- 6-phase implementation plan
- Risk assessment

### Step 4: Start Phase 1

Begin with session and config wrapping:

1. Wrap `client.session.*` calls in desktop session manager
2. Wrap `client.config.*` calls in desktop config manager
3. Sync to SQLite for offline access
4. Update IPC handlers to call SDK wrappers
5. Test with existing test suite (427 tests)

---

## 📊 Namespace Summary Table

| Namespace      | Methods | Priority | Status   | Notes                   |
| -------------- | ------- | -------- | -------- | ----------------------- |
| **session**    | 24      | ⭐⭐⭐   | ✅ Ready | Core; streaming support |
| **config**     | 3       | ⭐⭐⭐   | ✅ Ready | Core; JSONC caveat      |
| **mcp**        | 4       | ⭐⭐⭐   | ✅ Ready | Core; no remove()       |
| **event**      | 1       | ⭐⭐⭐   | ✅ Ready | Core; SSE streaming     |
| **file**       | 3       | ⭐⭐     | ✅ Ready | Secondary; no write()   |
| **find**       | 3       | ⭐⭐     | ✅ Ready | Secondary               |
| **permission** | 3       | ⭐⭐     | ✅ Ready | Secondary               |
| **project**    | 4       | ⭐⭐     | ✅ Ready | Secondary               |
| **vcs**        | 2       | ⭐⭐     | ✅ Ready | Secondary               |
| **pty**        | 8       | ⭐⭐     | ✅ Ready | Secondary               |
| **question**   | 3       | ⭐⭐     | ✅ Ready | Secondary               |
| **tui**        | 11      | ⭐⭐     | ✅ Ready | Secondary               |
| **auth**       | 2       | ⭐       | ✅ Ready | Utility                 |
| **auth2**      | 4       | ⭐       | ✅ Ready | Utility                 |
| **provider**   | 2       | ⭐       | ✅ Ready | Utility                 |
| **part**       | 2       | ⭐       | ✅ Ready | Utility                 |
| **sync**       | 3       | ⭐       | ✅ Ready | Utility                 |
| **tool**       | 2       | ⭐       | ✅ Ready | Utility                 |
| **worktree**   | 4       | ⭐       | ✅ Ready | Utility                 |
| **app**        | 3       | ⭐       | ✅ Ready | Utility                 |
| **global**     | 4       | ⭐       | ✅ Ready | Utility                 |
| **command**    | 1       | ⭐       | ✅ Ready | Utility                 |
| **lsp**        | 1       | ⭐       | ✅ Ready | Utility                 |
| **formatter**  | 1       | ⭐       | ✅ Ready | Utility                 |
| **path**       | 1       | ⭐       | ✅ Ready | Utility                 |

---

## 🔗 Related Documentation

- **Desktop Architecture**: `desktop/docs/ARCHITECTURE.md`
- **MCP Server Internals**: `desktop/docs/MCP-SERVER.md`
- **IPC API**: `desktop/docs/IPC-API.md`
- **Database Schema**: `desktop/docs/DATABASE.md`
- **Settings Config**: `desktop/docs/SETTINGS-CONFIG.md`

---

## 📝 Key Takeaways

1. **SDK v2 is production-ready** for desktop integration
2. **150+ methods** across 25 namespaces
3. **3 core namespaces** (session, config, mcp) should be prioritized
4. **SSE streaming** enables real-time response delivery
5. **Desktop-specific features** (IPC, window, persistence) must remain custom
6. **JSONC preservation** requires manual handling
7. **6-7 week migration** plan with phased rollout
8. **High-value migrations** (session, config, MCP) first

---

## 🎓 Learning Path

**For Architects**:

1. Read [EXECUTIVE_SUMMARY.md](SDK_v2_EXECUTIVE_SUMMARY.md)
2. Read [MIGRATION_MATRIX.md](SDK_v2_MIGRATION_MATRIX.md)
3. Review risk assessment and success criteria

**For Developers**:

1. Read [CRITICAL_SIGNATURES.md](SDK_v2_CRITICAL_SIGNATURES.md)
2. Read [COMPLETE_CAPABILITY_MAP.md](SDK_v2_COMPLETE_CAPABILITY_MAP.md)
3. Start Phase 1 implementation

**For QA**:

1. Read [MIGRATION_MATRIX.md](SDK_v2_MIGRATION_MATRIX.md) success criteria
2. Review test coverage requirements
3. Plan validation for each phase

---

## 📞 Questions?

Refer to the appropriate document:

- **"What does SDK v2 provide?"** → [EXECUTIVE_SUMMARY.md](SDK_v2_EXECUTIVE_SUMMARY.md)
- **"How do I call method X?"** → [CRITICAL_SIGNATURES.md](SDK_v2_CRITICAL_SIGNATURES.md)
- **"What are all the methods?"** → [COMPLETE_CAPABILITY_MAP.md](SDK_v2_COMPLETE_CAPABILITY_MAP.md)
- **"How do I migrate?"** → [MIGRATION_MATRIX.md](SDK_v2_MIGRATION_MATRIX.md)
- **"Quick lookup?"** → [QUICK_REFERENCE.md](SDK_v2_QUICK_REFERENCE.md)

---

**Generated**: May 2026  
**SDK Source**: `desktop/node_modules/@opencode-ai/sdk/dist/v2/`  
**Last Updated**: 2026-05-10
