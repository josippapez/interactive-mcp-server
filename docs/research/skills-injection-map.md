# Skills & Instructions Injection — Complete Map

Research-only report. No files were modified.

---

## 1. `manage_skills_and_instructions` MCP Tool

**Defined ONLY in the desktop package.** The CLI package has no equivalent — `src/tool-definitions/` only contains `intensive-chat.ts`, `request-user-input.ts`, `types.ts`.

| Aspect                    | Location                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| Tool registration factory | `desktop/src/main/tools/manage-skills-and-instructions.ts:15` — `registerManageSkillsAndInstructionsTool` |
| Wired into MCP server     | `desktop/src/main/mcp-server/server-factory.ts:105-110`                                                   |
| Tool description block    | `desktop/src/main/tools/manage-skills-and-instructions.ts:24-70`                                          |

### Input schema (lines 72–120)

- `action`: `'register' | 'list' | 'get' | 'delete'` (required)
- `name`: string (required for register / get / delete)
- `type`: `'skill' | 'instruction'` (required for register)
- `description`, `content`: string (required for register)
- `category`: string (optional)
- `tags`: `string[]` (optional)
- `filterType`: `'skill' | 'instruction'` (optional, list action)
- `filterCategory`: string (optional, list action)

> Note: `category`, `tags`, and `filterCategory` are in the Zod schema (lines 98–119) but are **omitted from the `<parameters>` block in the tool description** — which only lists `action, name, type, description, content, filterType`. This is documentation drift.

### Actions (handler body, lines 122–368)

| Action               | Code range                                                                                                                                                                                                                | Behavior                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `register` (140–218) | Checks required fields; looks up pre-existing row with `getSkillOrInstructionByName` (159); calls `upsertSkillOrInstruction` (161); sends IPC `skills-updated` to renderer (187); calls `broadcastSkillsChanged('updated' | 'registered', …)`(190–195); returns JSON confirmation with`"will be automatically injected into all new agent sessions"` (213). |
| `list` (220–245)     | Calls `listSkillsAndInstructions(filterType, filterCategory)` (221); returns `{ count, entries[] }` where `content` is **NOT** included — only metadata (name, type, description, category, tags, updatedAt).             |
| `get` (247–301)      | Returns two `text` content blocks: (1) JSON metadata (283–293), (2) raw `entry.content` string (297).                                                                                                                     |
| `delete` (303–352)   | Calls `deleteSkillOrInstruction`; on success sends IPC `skills-updated` + `broadcastSkillsChanged('deleted', …)` (322–334).                                                                                               |
| default (354–366)    | Returns `INVALID_ACTION` error.                                                                                                                                                                                           |

### Guard (lines 133–137)

```ts
const providerSessionId = resolveProviderSessionId(connectionId);
const staleErr = providerSessionId
  ? staleSessionError(providerSessionId)
  : null;
if (staleErr) return staleErr;
```

Blocks writes from stale sessions but does not require `openCodeSessionId` on the wire — it derives one from the connection transport if possible.

---

## 2. Storage Layer (SQLite via **better-sqlite3**, not sql.js)

The AGENTS.md premise "SQLite via sql.js" is outdated. The DB engine is `better-sqlite3` (native bindings). Explicit migration comment at `desktop/src/main/database.ts:318-321`:

> "This replaces the previous sql.js (WASM) implementation which exhibited 'RuntimeError: memory access out of bounds' after prolonged use due to WASM heap fragmentation."

| Element                   | Location                                                                                                                                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Import                    | `desktop/src/main/database.ts:1-3` — `import Database from 'better-sqlite3'`                                                                                                                                                       |
| DB file path              | `desktop/src/main/database.ts:326` — `{userData}/conversations.db`                                                                                                                                                                 |
| Schema version constant   | `desktop/src/main/database.ts:18` — `SCHEMA_VERSION = 13`                                                                                                                                                                          |
| Initialization            | `desktop/src/main/database.ts:325-353` (`initDatabase`)                                                                                                                                                                            |
| Migration strategy        | **Drop and recreate** on version mismatch. `preserveSkillsAndInstructions` (437–469) → `dropAllTables` (391–411) → `createTables` (called at 346) → `restoreSkillsAndInstructions` (347). There are **no incremental migrations**. |
| WAL journal / NORMAL sync | `desktop/src/main/database.ts:332-334`                                                                                                                                                                                             |

### Table definitions

**`skills_and_instructions`** — `desktop/src/main/database.ts:199-214`

```sql
id          INTEGER PRIMARY KEY AUTOINCREMENT
name        TEXT NOT NULL UNIQUE
type        TEXT NOT NULL CHECK(type IN ('skill', 'instruction'))
description TEXT NOT NULL
content     TEXT NOT NULL
category    TEXT
tags        TEXT                      -- JSON-encoded string[]
enabled     INTEGER NOT NULL DEFAULT 1
is_builtin  INTEGER NOT NULL DEFAULT 0
created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
folder_id   INTEGER                   -- UI grouping only
scope       TEXT NOT NULL DEFAULT 'global'
            CHECK(scope IN ('global', 'session-scoped'))
```

**`folders`** — `desktop/src/main/database.ts:218-225` (UI grouping only; no injection effect)

**`session_scoped_entries`** — `desktop/src/main/database.ts:230-242`

```sql
provider_type       TEXT NOT NULL
provider_session_id TEXT NOT NULL
entry_name          TEXT NOT NULL
created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
PRIMARY KEY (provider_type, provider_session_id, entry_name)
-- INDEX idx_sse_entry_name ON (entry_name)
```

> Meaning: "this channel has **opted into** this entry."

**`session_muted_entries`** — `desktop/src/main/database.ts:248-260`

```sql
provider_type       TEXT NOT NULL
provider_session_id TEXT NOT NULL
entry_name          TEXT NOT NULL
created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
PRIMARY KEY (provider_type, provider_session_id, entry_name)
-- INDEX idx_sme_entry_name ON (entry_name)
```

> Meaning: "this channel has **muted** this global entry — do NOT inject for this specific session."

### CRUD functions (all in `desktop/src/main/database.ts`)

| Function                          | Line        | Notes                                                                                                  |
| --------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| `upsertSkillOrInstruction`        | 1233–1276   | `INSERT … ON CONFLICT(name) DO UPDATE`. Preserves folder/scope when not explicitly passed (1247–1252). |
| `listSkillsAndInstructions`       | 1279–1304   | `ORDER BY name ASC`; optional `filterType` + `filterCategory`.                                         |
| `getSkillOrInstructionByName`     | 1307–1319   | Single-row lookup.                                                                                     |
| `deleteSkillOrInstruction`        | 1322–1328   | `DELETE WHERE name = ?`.                                                                               |
| `toggleSkillOrInstructionEnabled` | 1331–1342   | UI toggle.                                                                                             |
| `duplicateSkillOrInstruction`     | 1349–1376   | Generates unique `-copy[-N]` name.                                                                     |
| `seedBuiltinTemplates`            | 1383–1420   | Insert-if-missing.                                                                                     |
| `resetBuiltinTemplates`           | 1428–1450+  | Reset-to-default.                                                                                      |
| `listSessionScopedEntryNames`     | 1813–~1830  | Used for opt-in filtering.                                                                             |
| `listSessionMutedEntryNames`      | ~1905–~1930 | Used for mute filtering.                                                                               |

### Related tables referenced by injection code

- `registered_connections` — `desktop/src/main/database.ts:263-276`, composite PK `(provider_type, provider_session_id)`. The join key between sessions and skills injection.
- `pending_context_injections` — `desktop/src/main/database.ts:283-299`. Used by `poll_context_injections` but **not** by the skills-injection pipeline (see Gap #8 below).

---

## 3. Injection Mechanism

There are **four** distinct code paths that inject DB-stored skills/instructions into an agent session, plus one **mutation broadcast** channel that sends a diff-only reminder.

### Entry point A — Explicit `register_connection` tool call

| Step                       | Location                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tool factory               | `desktop/src/main/tools/register-connection.ts:35-263`                                                                                                                   |
| Load entries               | `desktop/src/main/tools/register-connection.ts:206-217` — calls `listSkillsAndInstructions()` (215) + `listSessionScopedEntryNames('opencode', openCodeSessionId)` (207) |
| Build message              | `desktop/src/main/tools/register-connection.ts:210-217` — `buildStartupContextMessage(...)`                                                                              |
| Deliver                    | `desktop/src/main/tools/register-connection.ts:219-228` — `startStartupContextInjection(...)`                                                                            |
| Background injector        | `desktop/src/main/tools/register-connection-background.ts:121-189`                                                                                                       |
| For OpenCode provider      | `register-connection-background.ts:124-170` — calls `injectOpenCodeMessage(..., noReply=true, systemMessage=undefined)` with the reminder in the **user-message body**   |
| For non-OpenCode providers | `register-connection.ts:254-259` — message appended to the tool's own `CallToolResult` content array                                                                     |

### Entry point B — SSE `session.created` auto-register

Fires for every new OpenCode session (root + child) the moment SSE reports it.

| Step                                 | Location                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ | --- | ---------------------------------------------------------------------------------- |
| SSE event normalization              | `desktop/src/main/opencode/event-stream.ts:304-310` — handles both `session.created` and `session.created.1` |
| Dispatch                             | `desktop/src/main/session/sse-handlers.ts:51-68` — `handleSessionCreated`                                    |
| Gate                                 | `sse-handlers.ts:60` — `if (options.getAutoRegisterSubagents()) { autoRegisterSession(...) }`                |
| Auto-register helper                 | `desktop/src/main/session/auto-register.ts:78-187`                                                           |
| Already-claimed short-circuit        | `auto-register.ts:83-94`                                                                                     |
| Parent base-directory inheritance    | `auto-register.ts:102-122`                                                                                   |
| Row insert (`connection_id = NULL`)  | `auto-register.ts:139-147` — SSE is the **sole creator** of OpenCode rows                                    |
| Bootstrap message for child sessions | `auto-register.ts:155-165` — session-ID reminder                                                             |
| DB skills/instructions injection     | `auto-register.ts:175-182` — `injectDbSkillsAndInstructions(...)`                                            |
| Injection helper body                | `auto-register.ts:223-280`                                                                                   |
| Filter                               | `auto-register.ts:237-246` — `enabled && ((scope=='global')                                                  |     | optInSet.has(name))` (this path does **not** apply the muted filter — see Gap #11) |
| Build + deliver                      | `auto-register.ts:250-270` — `buildStartupContextMessage(...)` → `injectOpenCodeMessage(..., noReply=true)`  |
| Dedup participation                  | `auto-register.ts:274` — `markDbContextInjected(sessionId)`                                                  |

### Entry point C — MCP-transport auto-register (resume / first-connect race)

Fires when the MCP client's transport initializes and binds to an existing/new session row.

| Step                            | Location                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Factory                         | `desktop/src/main/mcp-server/auto-register.ts:38-175` — `autoRegisterDefaultConnection`                 |
| Main-channel OC detection       | `mcp-server/auto-register.ts:63-74` — only auto-detects session for `DEFAULT_MAIN_CHANNEL_NAME`         |
| Existing-row bind path (resume) | `mcp-server/auto-register.ts:89-107` — `updateConnectionId(...)` + `maybeInjectDbContextOnConnect(...)` |
| Fresh-row first-connect path    | `mcp-server/auto-register.ts:108-129`                                                                   |
| Non-OC fallback                 | `mcp-server/auto-register.ts:130-142` — synthetic `providerSessionId = connectionId`                    |
| Helper                          | `desktop/src/main/tools/db-context-injection.ts:110-214` — `maybeInjectDbContextOnConnect`              |
| Decision fn                     | `db-context-injection.ts:64-80` — `decideShouldInjectDbContext`                                         |
| Per-process dedupe set          | `db-context-injection.ts:47` — `const injectedSessionIds = new Set<string>()`                           |
| Scope filter                    | `db-context-injection.ts:121, 134-156` — respects **both** opt-in and mute lists                        |
| Delivery                        | `db-context-injection.ts:197-207` — reuses `startStartupContextInjection` from path A                   |

### Entry point D — `session.compacted` re-injection

OpenCode's auto-summarize rewrites history, dropping previously-injected `<system-reminder>` blocks. This path restores them.

| Step              | Location                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| SSE event type    | `desktop/src/main/opencode/event-stream.ts:400-410` — handles `session.compacted` and `session.compacted.1`  |
| Dispatch          | `desktop/src/main/session/sse-handlers.ts:101-109` — `handleSessionCompacted`                                |
| Helper            | `desktop/src/main/session/auto-register.ts:301-323` — `reinjectDbContextAfterCompaction`                     |
| Clear dedupe flag | `auto-register.ts:233-235` (inside `injectDbSkillsAndInstructions` called with `reason='session.compacted'`) |
| Re-run injection  | Same path as entry point B                                                                                   |

### Mutation-broadcast channel (diff-only, not a full re-inject)

| Step                            | Location                                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Caller                          | `desktop/src/main/tools/manage-skills-and-instructions.ts:190-195` (register/update) and `327-333` (delete)     |
| Fan-out                         | `desktop/src/main/tools/skills-broadcast.ts:56-88` — `broadcastSkillsChanged`                                   |
| Target picker (pure)            | `desktop/src/main/tools/skills-broadcast.ts:36-49` — `pickReminderTargets`                                      |
| Reminder shape                  | `desktop/src/main/tools/startup-context.ts:155-168` — `buildSkillsChangedReminder`                              |
| Per-session opt-in diff variant | `desktop/src/main/tools/skills-broadcast.ts:95-125` — `broadcastSessionScopeChanged` (called from IPC handlers) |
| Delivery primitive              | `desktop/src/main/opencode/injector.ts:67+` — `injectOpenCodeMessage(..., noReply=true)`                        |

> The diff reminder **does not re-send full content**. It just notes "a DB-stored `<type>` was `<action>`: `<name>`" and points the agent at `manage_skills_and_instructions list`/`get`.

---

## 4. Format of Injection

All four paths converge on a single shape: a text string that is the literal `<system-reminder>…</system-reminder>` block, delivered as a **`noReply=true` user message** via `injectOpenCodeMessage`.

### Full startup-context message (`desktop/src/main/tools/startup-context.ts:46-136`)

```
<system-reminder>
Interactive MCP Desktop session bootstrap:
- Registered agent: <channelName>
- Project: <projectName>
- Base directory: <baseDirectory or "not provided">
- OpenCode session ID: <id>                (only when present)
- Pass this as openCodeSessionId …          (only when id present)
- Prompting policy: use interactive prompt tools for user questions.
- Timeout policy: if a prompt times out or returns -32001, re-prompt immediately.
- Stop phrases (exact match): "Stop prompting", "End session", "Don't ask anymore", "Close conversation".
- Parallel subagents should use unique agent names to avoid sidebar name collisions.

<available_skills source="db">              (only if ≥1 skill included)
  <skill>
    <name>…</name>
    <description>…</description>
    <source>db</source>
  </skill>
  …
</available_skills>

<instructions source="db">                  (only if ≥1 instruction included)
  <instruction>
    <name>…</name>
    <description>…</description>
    <content>
…FULL MARKDOWN VERBATIM…
    </content>
  </instruction>
  …
</instructions>

Use the manage_skills_and_instructions tool with action "get" to retrieve
the full content of any skill by name.      (only if ≥1 skill)
</system-reminder>
```

### Key asymmetry (intentional; `startup-context.ts:8-15`)

- **Skills**: emitted with `name + description + <source>db</source>` only. Full content is **on-demand** via `manage_skills_and_instructions get`.
- **Instructions**: full `<content>` is **inlined verbatim**. Always-active policies the agent must follow immediately.

### Mutation-diff reminder (`startup-context.ts:155-168`)

```
<system-reminder>
A DB-stored <type> was <action>: <name>.
The latest list is available via the manage_skills_and_instructions tool with action "list".
<— for skills —> Use action "get" with the skill name to fetch its full content on demand.
<— for instructions —> Updated instruction content will be re-injected on the next session bootstrap.
</system-reminder>
```

### Session-scope-change reminder (`startup-context.ts:188-217`)

```
<system-reminder>
Session-scoped skills/instructions selection changed for this session.
Added (now active for this session):
- <type>: <name>
Removed (no longer active for this session):
- <type>: <name>
The full current list is available via the manage_skills_and_instructions tool with action "list".
Use action "get" with a skill name to fetch its full content on demand.
</system-reminder>
```

### Why user-message body, not `system` field?

Documented in `register-connection-background.ts:133-140` and reiterated in `auto-register.ts:208-215`:

> "OpenCode's per-call `system` only persists while the injected message is `lastUser`, so it disappears the moment the user sends their next real message. Storing the reminder in the message parts persists it in `messages[]` and OpenCode replays it on every step via `MessageV2.toModelMessages`. `noReply: true` keeps the agent from generating a turn for it."

The explicit comment `systemMessage — intentionally unused; see comment above` appears at `register-connection-background.ts:149` and `auto-register.ts:269`.

### Non-OpenCode delivery

For providers where `supportsProviderInjection === false`, there is no HTTP message API to call. Delivery falls back to appending the `startupContextMessage` to the `register_connection` tool's own `CallToolResult.content[]` (`register-connection.ts:254-259`). **There is no equivalent fallback on other tool calls** — so non-OC agents get the context once, at registration time, and never again.

---

## 5. Deduplication / Ordering / Size / Truncation

| Concern                                           | Behavior                                                                                                                                                                   | Location                                                                                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-process dedupe                                | In-memory `Set<providerSessionId>`; populated by `markDbContextInjected`; tested by `decideShouldInjectDbContext`                                                          | `db-context-injection.ts:47, 64-80, 223-243`                                                                                                             |
| Cross-restart dedupe                              | **None** — set is wiped on app restart. Comment at `db-context-injection.ts:23-26` says this is intentional because the agent's memory of the prior reminder is also gone. |
| Compaction reset                                  | `clearDbContextInjected(sessionId)` called before re-injection                                                                                                             | `auto-register.ts:233-235`                                                                                                                               |
| Scope filter (MCP-transport path)                 | `(global && !muted) \|\| (session-scoped && opted-in)`                                                                                                                     | `db-context-injection.ts:152-156`                                                                                                                        |
| Scope filter (SSE-path, register-connection path) | `(global) \|\| (session-scoped && opted-in)` — **mutes are NOT applied**                                                                                                   | `auto-register.ts:244-246`; `startup-context.ts:90-95` (the pure builder honours mutes, but its callers in paths A and B never pass `sessionMutedNames`) |
| `enabled === false` exclusion                     | Always applied                                                                                                                                                             | `auto-register.ts:238`; `db-context-injection.ts:121`; `startup-context.ts:92`                                                                           |
| Ordering                                          | SQL `ORDER BY name ASC`. Skills and instructions are then split into separate blocks; inside each block order is alphabetical by name.                                     | `database.ts:1300`; `startup-context.ts:96-97, 99-125`                                                                                                   |
| Size limit                                        | **None.** All enabled instructions are inlined verbatim. No byte/character cap, no pagination.                                                                             | `startup-context.ts:118-122`                                                                                                                             |
| Truncation / chunking                             | **None.**                                                                                                                                                                  | —                                                                                                                                                        |
| Empty-block suppression                           | Blocks only emitted when ≥1 entry                                                                                                                                          | `startup-context.ts:99, 112`                                                                                                                             |
| XML escaping                                      | **None** — raw interpolation of name/description/content into an XML-shaped string. Caller could inject `</content>` and break parsing.                                    | `startup-context.ts:104-105, 117-121`                                                                                                                    |
| Provider filter (mutation broadcast)              | Only `providerType === 'opencode'` rows targeted; duplicates collapsed by `providerSessionId`                                                                              | `skills-broadcast.ts:36-49`                                                                                                                              |

---

## 6. Auto-Registered vs Manual `register_connection` — Injection Differences

| Aspect                                                | SSE auto-register (session.created)                                                     | Manual `register_connection`                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Trigger                                               | OpenCode SSE `session.created(.1)`                                                      | Agent tool call                                                                                                 |
| Row insert                                            | `connection_id = NULL`; channelName = session title; projectName = literal `'OpenCode'` | Agent-supplied channelName, projectName; connectionId = MCP transport ID                                        |
| baseDirectory source                                  | OpenCode session's `directory` (with parent inheritance when it looks like `$HOME`)     | Agent-supplied; auto-detects OC session if caller doesn't pass one                                              |
| Child-session bootstrap message (session-ID reminder) | Yes — `auto-register.ts:41-51, 155-165`                                                 | No — subagent is already expected to know its ID                                                                |
| DB skills/instructions injected                       | **Yes** — `injectDbSkillsAndInstructions` (`auto-register.ts:175-182`)                  | **Yes** — `startStartupContextInjection` (`register-connection.ts:219-228`)                                     |
| Scope filtering                                       | `enabled && (global \|\| opted-in)` — **does NOT apply mutes** (Gap #11)                | Same (via `buildStartupContextMessage` call that also doesn't forward `sessionMutedNames`)                      |
| Provider support                                      | OpenCode only (helper hard-codes provider at call sites)                                | All providers — fallback path appends reminder to tool result for providers without `supportsProviderInjection` |
| Doc-context (repo docs) initialization                | Not called                                                                              | Yes — `initDocContext(...)` at `register-connection.ts:188-195`                                                 |
| Project-MCP injection                                 | Not called                                                                              | Imported but currently **not called** from `register-connection.ts` (see Gap #5)                                |
| Session-tree invalidation                             | Yes — `invalidateSessionTree()`                                                         | Yes — via `updateSessionTreeAfterRegistration`                                                                  |
| Channel-label sync                                    | N/A (uses session title directly)                                                       | Factory emits `channel-label-updated` — `server-factory.ts:97-101`                                              |
| Dedup key                                             | Shared `injectedSessionIds` set                                                         | Same set                                                                                                        |

**Net injection of DB skills/instructions is identical** across both paths because both assemble the message via `buildStartupContextMessage` and deliver via `injectOpenCodeMessage(noReply=true)`.

---

## 7. Documentation vs Code Divergence

The tool description (`manage-skills-and-instructions.ts:26, 32, 213`) makes three claims. Verified against code:

| Claim                                                                                                                                | Reality                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "automatically injected into every new agent session on registration" (line 26)                                                      | ✓ for OpenCode sessions (SSE path B fires regardless of `register_connection`). ✗ for non-OC sessions — those only receive context in the tool-result of their own `register_connection` call and never again. |
| "ALL registered skills and instructions are automatically injected into agent sessions when they call register_connection" (line 32) | ✗ "ALL" is false — only `enabled === true` and scope-matching entries. ✗ "when they call register_connection" is misleading — SSE path injects without any tool call.                                          |
| "will be automatically injected into all new agent sessions" (line 213, success message)                                             | Same as above.                                                                                                                                                                                                 |
| `<parameters>` block (lines 54-61) lists only `action, name, type, description, content, filterType`                                 | Schema accepts additionally `category`, `tags`, `filterCategory`.                                                                                                                                              |
| Root `AGENTS.md`: "Calling `register_connection` is optional but recommended"                                                        | ✓ confirmed — SSE auto-register covers the required side effects.                                                                                                                                              |
| Root `AGENTS.md`: agents MUST pass `openCodeSessionId` on every tool call                                                            | ✓ enforced at the tool boundary via `resolveProviderSessionId` + `requireProviderSessionId`.                                                                                                                   |
| `desktop/AGENTS.md` mentions "sql.js via `sqlite3`" history                                                                          | ✗ code already migrated to `better-sqlite3` (`database.ts:1-3, 318-321`).                                                                                                                                      |

---

## 8. Tests Covering Injection Behavior

**There are NO tests directly covering the injection pipeline.**

Complete list of `*.test.ts` under `desktop/src/main/`:

- `desktop/src/main/opencode/shell-env.test.ts`
- `desktop/src/main/opencode/prompt-event-forwarder.test.ts`
- `desktop/src/main/opencode/event-coalesce.test.ts`
- `desktop/src/main/opencode/event-stream-session-events.test.ts`

None of these exercise `startup-context.ts`, `db-context-injection.ts`, `auto-register.ts`, or `skills-broadcast.ts`.

Despite code comments that promise tests:

- `db-context-injection.ts:28` — "Pure helpers in this module are unit-tested in `db-context-injection.test.ts`." **The referenced file does not exist.**
- `decideShouldInjectDbContext` at `db-context-injection.ts:60-80` is commented "Exported for unit testing." No tests exist.
- `pickReminderTargets` at `skills-broadcast.ts:36-49` is described as "Extracted as a pure function so the side-effectful injector loop … can be tested without mocking the OpenCode HTTP client." No tests exist.
- `buildStartupContextMessage`, `buildSkillsChangedReminder`, `buildSessionScopeChangedReminder` are all pure functions with no test coverage.

---

## Text Sequence Diagrams

### Diagram 1 — OpenCode ROOT session starts (SSE path)

```
User spawns/opens an OpenCode session
    │
    ▼
OpenCode sends SSE: session.created.1
    │
    ▼
event-stream.ts:304           normalizes payload type
    │  emits 'session.created' via OpenCodeEventBridge
    ▼
sse-handlers.ts:51            handleSessionCreated
    │  if autoRegisterSubagents enabled
    ▼
auto-register.ts:78           autoRegisterSession
    │
    ├─▶ isProviderSessionClaimed(id,'opencode')? → skip if claimed
    │
    ├─▶ upsertRegisteredConnection           (connection_id = NULL)
    │     desktop/src/main/database.ts (registered_connections row)
    │
    ├─▶ if info.parentID:  injectOpenCodeMessage
    │     (child bootstrap <system-reminder> with session+parent ID)
    │     auto-register.ts:155-165
    │
    ├─▶ injectDbSkillsAndInstructions
    │     auto-register.ts:223
    │       │
    │       ├─▶ listSkillsAndInstructions()              (database.ts:1279)
    │       ├─▶ listSessionScopedEntryNames(...)         (database.ts:1813)
    │       ├─▶ filter: enabled && (global || optedIn)
    │       ├─▶ if effective.length === 0 → return
    │       ├─▶ buildStartupContextMessage(...)          (startup-context.ts:46)
    │       ├─▶ injectOpenCodeMessage(
    │       │      sessionId, reminder, attachments=undef,
    │       │      port, mcpPort=undef, noReply=true,
    │       │      modelOverride=undef, systemMessage=undef)
    │       │   └─▶ HTTP POST /session/{id}/message to OpenCode
    │       └─▶ markDbContextInjected(sessionId)         (dedup set)
    │
    └─▶ invalidateSessionTree()
          │
          ▼
      Renderer IPC 'session-tree-invalidated'
          │
          ▼
      Renderer refetches tree, sidebar updates
```

### Diagram 2 — MCP transport later binds to the same session

```
MCP client initialize() → server-factory.ts creates server
    │
    ▼
autoRegisterDefaultConnection            mcp-server/auto-register.ts:38
    │
    ▼
autoDetectOpenCodeSession(port, baseDir)
    │  returns detected session
    ▼
getRegisteredConnectionBySessionId(detected.id, 'opencode')
    │
    ├─ existing row? (created by SSE path earlier)
    │     │
    │     ├─▶ updateConnectionId(detected.id, connectionId, 'opencode')
    │     ├─▶ createSessionChannel(...)
    │     ├─▶ invalidateSessionTree()
    │     └─▶ maybeInjectDbContextOnConnect(...)
    │           db-context-injection.ts:110
    │             │
    │             ▼
    │         decideShouldInjectDbContext({
    │             openCodeSessionId,
    │             alreadyInjected: injectedSessionIds,
    │             enabledEntryCount })
    │             │
    │             ├─ 'already-injected-this-process' → NO-OP (usual case)
    │             ├─ 'no-enabled-entries'           → NO-OP
    │             ├─ 'no-session-id'                → NO-OP
    │             └─ 'inject':
    │                   injectedSessionIds.add(sessionId)
    │                   buildStartupContextMessage(...)
    │                   startStartupContextInjection(...)
    │                     └─▶ injectOpenCodeMessage(noReply=true)
    │
    └─ no existing row? (first-connect race)
          upsertRegisteredConnection(...)
          maybeInjectDbContextOnConnect(...)   (same as above)
```

### Diagram 3 — Explicit `register_connection` tool call

```
Agent calls register_connection({
  channelName, projectName, baseDirectory, openCodeSessionId })
    │
    ▼
register-connection.ts:79
    │
    ├─▶ getBackendAdapter(backend)              (supports provider injection?)
    │
    ├─▶ if supportsProviderInjection && !openCodeSessionId && baseDirectory:
    │        autoDetectOpenCodeSession(port, baseDirectory)
    │     else if openCodeSessionId:
    │        fetchOpenCodeSession(...)          (to read parentID)
    │
    ├─▶ upsertRegisteredConnection({providerSessionId, providerType,
    │        connectionId, channelName, projectName, baseDirectory,
    │        parentSessionId})
    │
    ├─▶ createSessionChannel(connectionId, channelName)
    │
    ├─▶ updateSessionTreeAfterRegistration(...)  (invalidate tree)
    │
    ├─▶ if doc indexing enabled:  initDocContext(...)
    │
    ├─▶ listSessionScopedEntryNames('opencode', openCodeSessionId)
    ├─▶ listSkillsAndInstructions()
    ├─▶ startupContextMessage =
    │       buildStartupContextMessage({
    │         channelName, projectName, baseDirectory,
    │         openCodeSessionId, entries, sessionOptInNames })
    │
    ├─▶ startStartupContextInjection({
    │       getWindow, connectionId, openCodeSessionId,
    │       startupContextMessage, getOpenCodePort,
    │       backendName, runtime, supportsProviderInjection })
    │     │
    │     ├─ if supportsProviderInjection && openCodeSessionId:
    │     │     injectOpenCodeMessage(
    │     │         openCodeSessionId, startupContextMessage,
    │     │         attachments=undef, port, mcpPort=undef,
    │     │         noReply=true, modelOverride=undef,
    │     │         systemMessage=undef)   // deliberately unused
    │     │       └─▶ HTTP POST /session/{id}/message
    │     │
    │     └─ else:
    │           sendSessionStatus(... 'Startup context prepared (<backend> mode)')
    │
    └─▶ return CallToolResult:
          content[0] = { type: 'text', text: JSON.stringify({
              ok:true, connectionId, channelName, …, idFilePath }) }
          if !openCodeSessionId:
            content[1] = { type: 'text', text: startupContextMessage }
            // fallback delivery for non-OC providers
```

### Diagram 4 — `session.compacted` re-injection

```
OpenCode auto-summarizes session history
    │
    ▼
SSE event: session.compacted(.1)
    │
    ▼
event-stream.ts:400-410
    │
    ▼
sse-handlers.ts:101             handleSessionCompacted
    │
    ▼
auto-register.ts:301            reinjectDbContextAfterCompaction
    │
    ├─▶ getRegisteredConnectionBySessionId(sessionId, 'opencode')
    │     if no row → log + return
    │
    └─▶ injectDbSkillsAndInstructions({ ..., reason: 'session.compacted' })
          │  clearDbContextInjected(sessionId)      // reset dedup flag
          │
          └─▶ (same flow as Diagram 1 injection block —
               builds full <system-reminder> and injects via HTTP)
```

### Diagram 5 — Mutation broadcast (diff-only)

```
Agent calls manage_skills_and_instructions({ action: 'register'|'delete', … })
    │
    ▼
manage-skills-and-instructions.ts:122
    │
    ├─ action='register':
    │     preExisting = getSkillOrInstructionByName(name)
    │     record = upsertSkillOrInstruction({...})
    │     getWindow()?.webContents.send('skills-updated')       // renderer IPC
    │     broadcastSkillsChanged(
    │         preExisting ? 'updated' : 'registered',
    │         record.type, record.name, port)
    │
    └─ action='delete':
          existing = getSkillOrInstructionByName(name)
          deleteSkillOrInstruction(name)
          getWindow()?.webContents.send('skills-updated')
          broadcastSkillsChanged('deleted', existing.type, name, port)

broadcastSkillsChanged (skills-broadcast.ts:56)
    │
    ├─▶ getRegisteredConnectionsByProvider('opencode')
    │
    ├─▶ pickReminderTargets(connections)
    │     └─ filter providerType==='opencode' && providerSessionId
    │        dedupe by providerSessionId
    │
    ├─▶ buildSkillsChangedReminder({ action, type, name })
    │     (startup-context.ts:155 — diff-only reminder, no full content)
    │
    └─▶ for each target:
          injectOpenCodeMessage(target.providerSessionId, reminder,
              attachments=undef, port, mcpPort=undef, noReply=true,
              modelOverride=undef, systemMessage=undef)
            .catch(err → log.warn)                               // fire-and-forget
```

---

## Gaps Between Documented Behavior and Actual Code

1. **Tool description claims injection is tied to `register_connection`** — but the SSE path (B) and the MCP-transport path (C) inject independently of any tool call. (`manage-skills-and-instructions.ts:26, 32`)
2. **"ALL registered" is false** — only `enabled === true` and scope-matching entries are injected. Disabled / muted / non-opted-in entries are silently excluded.
3. **Undocumented schema fields** — `category`, `tags`, `filterCategory` accepted by Zod (schema lines 98–119) but absent from the `<parameters>` block of the description (lines 54–61).
4. **Referenced-but-missing test file** — `db-context-injection.ts:28` names `db-context-injection.test.ts` which does not exist in the repo.
5. **`startProjectMcpInjection` is declared but never called** — `register-connection-background.ts:55-119` exports it, but `register-connection.ts` does not invoke it. Appears to be historical.
6. **No XML escaping** of user-supplied `name` / `description` / `content` — a skill whose content contains `</content>` or `</instructions>` literally breaks the shape of the system-reminder envelope. (`startup-context.ts:104-105, 117-121`)
7. **No size / character-budget guardrail** — every enabled instruction's full content is inlined verbatim on every bootstrap. Potential silent context-window blow-up. (`startup-context.ts:118-122`)
8. **`poll_context_injections` is not a delivery channel for skills/instructions** — the tool's description (`poll-context-injections.ts:48`) says "After calling register_connection, to receive any startup context that was queued", but skills/instructions are delivered via `injectOpenCodeMessage` body, **not** enqueued into `pending_context_injections`. Non-OpenCode agents therefore cannot obtain DB skills through this tool.
9. **AGENTS.md premise "SQLite via sql.js" is obsolete** — code uses `better-sqlite3` (`database.ts:1-3, 318-321`).
10. **Compaction re-injection is SSE-dependent and non-retryable** — if the desktop app misses the `session.compacted` event (restart during compaction, transient SSE drop), the agent silently loses its standing rules until the next SSE event or app restart.
11. **`sessionMutedNames` filter is inconsistent across paths** — `buildStartupContextMessage` accepts it and applies it (`startup-context.ts:56, 93`), but:
    - SSE path (`auto-register.ts:250-257`) does **not** pass `sessionMutedNames`.
    - Explicit `register_connection` path (`register-connection.ts:210-217`) does **not** pass `sessionMutedNames`.
    - Only the MCP-transport path (`db-context-injection.ts:180-188`) passes it.
      Effect: a session can mute a global entry and that mute will apply on MCP-transport reconnect but **not** on SSE auto-register or explicit `register_connection`.
12. **Per-process dedupe set is never cleared on session deletion** — if a session is deleted and recreated with the same ID within a single process lifetime, injection is skipped because the dedupe flag persists. Unlikely in practice but not defensively handled.
13. **`listSkillsAndInstructions` sorts alphabetically by name**; there is no user-facing ordering (e.g., pin, priority, folder-aware). Agents see entries in a deterministic but opaque order.

---

## Files That Would Need Changes to Modify Injection Behavior

### Core pipeline (touched by almost any change)

- `desktop/src/main/tools/startup-context.ts` — message shape, scope filter logic, skill/instruction block split, reminder templates
- `desktop/src/main/session/auto-register.ts` — SSE-path injection (entry points B and D)
- `desktop/src/main/tools/db-context-injection.ts` — MCP-transport-path injection (entry point C), per-process dedupe
- `desktop/src/main/tools/register-connection-background.ts` — delivery wrapper (`startStartupContextInjection`)
- `desktop/src/main/tools/register-connection.ts` — entry point A message assembly (lines 206–228)

### Storage layer

- `desktop/src/main/database.ts` — DDL (198-260), schema version (18), CRUD helpers (1233-1341, 1813+, ~1905+). Bump `SCHEMA_VERSION` whenever DDL changes.

### Tool definition / description

- `desktop/src/main/tools/manage-skills-and-instructions.ts` — schema, description text, broadcast invocations

### Mutation broadcast

- `desktop/src/main/tools/skills-broadcast.ts` — target selection, diff reminder fan-out

### Lifecycle triggers

- `desktop/src/main/session/sse-handlers.ts` — SSE → handler dispatch
- `desktop/src/main/opencode/event-stream.ts` — SSE payload normalization (304-310, 400-410)
- `desktop/src/main/mcp-server/auto-register.ts` — MCP-transport init path (38-175)
- `desktop/src/main/mcp-server/server-factory.ts` — tool registration wiring (90-113)

### Delivery primitive

- `desktop/src/main/opencode/injector.ts` — `injectOpenCodeMessage` (the HTTP call all paths share)

### Non-OpenCode delivery alternative

- `desktop/src/main/tools/poll-context-injections.ts` — currently not a skills carrier; would be the file to modify if skills should also be delivered to non-OC providers via polling
- `desktop/src/main/database.ts` `pending_context_injections` table + helpers — required if skills are routed through polling

### Renderer / IPC (for UI changes)

- `desktop/src/main/ipc/handlers/skills-handlers.ts` — renderer CRUD bindings (also invokes `broadcastSessionScopeChanged`)
- `desktop/src/main/ipc/handlers/shared.ts` — surfaces `listSkillsAndInstructions('skill')` to renderer

### CLI package (only if skills tool is to be ported)

- `src/tool-definitions/` — would need a new `manage-skills-and-instructions.ts` tool definition
- `src/index.ts` — registration of the new tool

### Tests that should be authored (none currently exist)

- `desktop/src/main/tools/startup-context.test.ts`
- `desktop/src/main/tools/db-context-injection.test.ts` (already referenced by code comment but missing)
- `desktop/src/main/tools/skills-broadcast.test.ts`
- `desktop/src/main/session/auto-register.test.ts`
- `desktop/src/main/session/sse-handlers.test.ts`
