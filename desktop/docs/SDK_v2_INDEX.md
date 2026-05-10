# @opencode-ai/sdk v2 — Complete Documentation Index

**Generated**: May 10, 2026  
**Source**: `/Users/josippapez/Desktop/interactive-mcp-server/desktop/node_modules/@opencode-ai/sdk/dist/v2/`  
**Purpose**: Authoritative capability map for migration planning

---

## 📚 Documentation Files

### 1. **SDK_v2_MIGRATION_SUMMARY.txt** (328 lines)

**Start here** — Executive summary and quick facts.

**Contains**:

- Executive summary (what SDK covers, what must stay custom)
- 40 namespaces inventory
- Top 10 most-used methods
- 70+ SSE event topics
- Migration priority matrix (🔴 high, 🟡 medium, 🟢 low, ⚫ keep custom)
- Migration checklist (6 phases)
- Known limitations
- Next steps

**Best for**: Getting oriented, understanding scope, planning phases.

---

### 2. **SDK_v2_QUICK_REFERENCE.md** (212 lines)

**Quick lookup** — Namespace overview and code examples.

**Contains**:

- 40 namespaces at a glance (table format)
- Top 10 most-used methods
- Event stream highlights
- Migration priority matrix
- Code example: Basic session flow
- SDK v2 vs custom Eden comparison table
- Known limitations
- Next steps

**Best for**: Quick lookups, understanding which methods to use, code examples.

---

### 3. **SDK_v2_CAPABILITY_MAP.md** (651 lines)

**Comprehensive reference** — Complete namespace documentation.

**Contains**:

- Client initialization
- 14 primary namespaces with full method tables:
  - App (3 methods)
  - Session2 (18 methods)
  - Message operations (Part: 2 methods)
  - File & Find (6 methods)
  - Permission & Auth (9 methods)
  - Config & Provider (8 methods)
  - Project & Path (4 methods)
  - MCP & Tools (7 methods)
  - TUI & Prompt (14 methods)
  - Workspace & Worktree (9 methods)
  - LSP & Formatter (2 methods)
  - PTY & Shell (8 methods)
  - VCS & Sync (6 methods)
  - Global & Instance (6 methods)
- 70+ SSE event topics (organized by family)
- Notable gaps vs desktop needs
- Migration checklist (6 phases)
- Version notes and references

**Best for**: Deep dives, understanding method signatures, event handling, comprehensive reference.

---

### 4. **SDK_v2_METHOD_SIGNATURES.md** (1067 lines)

**Detailed reference** — All 150+ methods with full signatures.

**Contains**:

- Session2 (18 methods with full signatures)
- Part (2 methods)
- File (3 methods)
- Find (3 methods)
- Permission (3 methods)
- Auth (2 methods)
- Auth2 (4 methods)
- Config (2 methods)
- Config2 (3 methods)
- Provider (3 methods)
- Project (3 methods)
- Path (1 method)
- VCS (2 methods)
- Mcp (5 methods)
- Tool (2 methods)
- Tui (11 methods)
- Question (3 methods)
- Workspace (5 methods)
- Worktree (4 methods)
- Pty (8 methods)
- Sync (4 methods)
- Lsp (1 method)
- Formatter (1 method)
- App (3 methods)
- Command (1 method)
- Event (1 method)
- Global (5 methods)
- Instance (1 method)
- Additional namespaces (Experimental, Console, Resource, Adapter, Control, Oauth, History, V2)
- Type definitions (Auth, Permission, Model)
- Error handling patterns

**Best for**: Copy-paste method signatures, understanding parameter types, implementing specific features.

---

## 🎯 Quick Navigation

### By Use Case

**I want to...**

- **Understand what SDK covers** → Read `SDK_v2_MIGRATION_SUMMARY.txt`
- **See all namespaces** → Read `SDK_v2_QUICK_REFERENCE.md` (table)
- **Find a specific method** → Search `SDK_v2_METHOD_SIGNATURES.md`
- **Understand session lifecycle** → Read `SDK_v2_CAPABILITY_MAP.md` → Session Namespace
- **Handle streaming events** → Read `SDK_v2_CAPABILITY_MAP.md` → Event Stream (SSE Topics)
- **Plan migration phases** → Read `SDK_v2_MIGRATION_SUMMARY.txt` → Migration Checklist
- **See code examples** → Read `SDK_v2_QUICK_REFERENCE.md` → Code Example section
- **Understand permissions** → Read `SDK_v2_CAPABILITY_MAP.md` → Permission & Auth section
- **Learn about MCP** → Read `SDK_v2_CAPABILITY_MAP.md` → MCP & Tools section

### By Namespace

| Namespace  | Primary Doc   | Quick Ref | Signatures |
| ---------- | ------------- | --------- | ---------- |
| Session2   | ✅ Full table | ✅ Top 10 | ✅ Full    |
| Part       | ✅ Full table | —         | ✅ Full    |
| File       | ✅ Full table | —         | ✅ Full    |
| Find       | ✅ Full table | —         | ✅ Full    |
| Permission | ✅ Full table | —         | ✅ Full    |
| Auth       | ✅ Full table | —         | ✅ Full    |
| Config     | ✅ Full table | —         | ✅ Full    |
| Provider   | ✅ Full table | —         | ✅ Full    |
| Project    | ✅ Full table | —         | ✅ Full    |
| Mcp        | ✅ Full table | —         | ✅ Full    |
| Tool       | ✅ Full table | —         | ✅ Full    |
| Tui        | ✅ Full table | —         | ✅ Full    |
| Question   | ✅ Full table | —         | ✅ Full    |
| Workspace  | ✅ Full table | —         | ✅ Full    |
| Worktree   | ✅ Full table | —         | ✅ Full    |
| Pty        | ✅ Full table | —         | ✅ Full    |
| Sync       | ✅ Full table | —         | ✅ Full    |
| Lsp        | ✅ Full table | —         | ✅ Full    |
| Formatter  | ✅ Full table | —         | ✅ Full    |
| App        | ✅ Full table | —         | ✅ Full    |
| Command    | ✅ Full table | —         | ✅ Full    |
| Event      | ✅ Full table | —         | ✅ Full    |
| Global     | ✅ Full table | —         | ✅ Full    |
| Instance   | ✅ Full table | —         | ✅ Full    |

---

## 📊 Key Statistics

| Metric             | Count |
| ------------------ | ----- |
| Total namespaces   | 40    |
| Total methods      | 150+  |
| SSE event topics   | 70+   |
| Session methods    | 18    |
| Message methods    | 2     |
| File methods       | 3     |
| Search methods     | 3     |
| Permission methods | 3     |
| Auth methods       | 6     |
| Config methods     | 5     |
| Provider methods   | 3     |
| Project methods    | 3     |
| MCP methods        | 5     |
| Tool methods       | 2     |
| TUI methods        | 11    |
| Question methods   | 3     |
| Workspace methods  | 5     |
| Worktree methods   | 4     |
| PTY methods        | 8     |
| Sync methods       | 4     |
| LSP methods        | 1     |
| Formatter methods  | 1     |
| App methods        | 3     |
| Command methods    | 1     |
| Event methods      | 1     |
| Global methods     | 5     |
| Instance methods   | 1     |

---

## 🚀 Migration Roadmap

### Phase 1: Session Management (Week 1-2)

**Files to read**: `SDK_v2_CAPABILITY_MAP.md` → Session Namespace  
**Methods**: list, create, get, delete, update, message, messages, deleteMessage, revert, unrevert

### Phase 2: Prompt/Command Handling (Week 2-3)

**Files to read**: `SDK_v2_CAPABILITY_MAP.md` → Session Namespace + Event Stream  
**Methods**: prompt, promptAsync, command, shell  
**Events**: session.next.\* (24 event types)

### Phase 3: Permission & Auth (Week 3)

**Files to read**: `SDK_v2_CAPABILITY_MAP.md` → Permission & Auth section  
**Methods**: permission.list, permission.reply, auth.set, auth.remove, auth.oauth

### Phase 4: File & Search (Week 4)

**Files to read**: `SDK_v2_CAPABILITY_MAP.md` → File & Find section  
**Methods**: file.list, file.read, find.files, find.text, find.symbols

### Phase 5: MCP & Tools (Week 4-5)

**Files to read**: `SDK_v2_CAPABILITY_MAP.md` → MCP & Tools section  
**Methods**: mcp.connect, mcp.disconnect, mcp.add, tool.list

### Phase 6: Keep Custom (Ongoing)

**Files to read**: `SDK_v2_MIGRATION_SUMMARY.txt` → Notable Gaps  
**Keep**: IPC handlers, auto-update, SQLite persistence, UI state, native dialogs

---

## 📖 External References

- **OpenCode Server Docs**: https://opencode.ai/docs/server/
- **OpenCode SDK Docs**: https://opencode.ai/docs/sdk/
- **OpenCode Agents**: https://opencode.ai/docs/agents/
- **OpenCode Config**: https://opencode.ai/docs/config/

---

## 🔍 Search Tips

### Finding a specific method

1. Open `SDK_v2_METHOD_SIGNATURES.md`
2. Search for method name (e.g., "prompt", "create", "list")
3. Copy full signature

### Finding a namespace

1. Open `SDK_v2_QUICK_REFERENCE.md`
2. Search for namespace name (e.g., "Session2", "Permission")
3. See method count and purpose

### Finding event topics

1. Open `SDK_v2_CAPABILITY_MAP.md`
2. Go to "Event Stream (SSE Topics)" section
3. Search for event family (e.g., "session.next", "message", "permission")

### Finding migration guidance

1. Open `SDK_v2_MIGRATION_SUMMARY.txt`
2. Go to "Migration Checklist" section
3. Find your phase (1-6)

---

## ✅ Verification Checklist

Before starting migration:

- [ ] Read `SDK_v2_MIGRATION_SUMMARY.txt` (10 min)
- [ ] Read `SDK_v2_QUICK_REFERENCE.md` (15 min)
- [ ] Skim `SDK_v2_CAPABILITY_MAP.md` (20 min)
- [ ] Identify custom modules to replace (30 min)
- [ ] Create detailed migration plan (1 hour)
- [ ] Set up test environment (1 hour)
- [ ] Start Phase 1 (session management)

---

## 📝 Notes

- **SDK v2 Release**: May 2026
- **Stability**: Production-ready
- **Breaking changes from v1**: Session snapshot API, compaction API, improved streaming
- **Recommended for**: New desktop integrations, migration from custom session management
- **Not recommended for**: Legacy v1 integrations (use v1 SDK instead)

---

## 🤝 Contributing

If you find gaps or errors in this documentation:

1. Check the source files in `/desktop/node_modules/@opencode-ai/sdk/dist/v2/`
2. Update the relevant documentation file
3. Verify against OpenCode official docs
4. Commit with clear message

---

**Last updated**: May 10, 2026  
**Total documentation**: 2,258 lines across 4 files  
**Coverage**: 40 namespaces, 150+ methods, 70+ events
