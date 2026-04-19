# Provider Session ID Unification — Refactor Plan

**Status:** Proposed
**Scope:** `desktop/` (Electron app). CLI package (`src/`) unaffected.
**Goal:** Collapse the dual-identifier (`connectionId` + `openCodeSessionId`) complexity to a single canonical identity key — `providerSessionId` — used everywhere in persistent state, in-memory maps, and IPC payloads. `connectionId` becomes a pure transport handle that only lives as a nullable column on `registered_connections`.

---

## Post-Phase-6 follow-up (2026-04)

Several routing bugs surfaced after Phase 6 because residual code paths still
matched on the shared MCP `connectionId` instead of the unique
`providerSessionId`. Cross-channel message corruption (a subagent's messages
appearing in a sibling/parent channel) was traced to those fallbacks.

Fixes applied as a follow-up sweep (see git history around the "providerSessionId
routing fix" commits):

- Removed dead `?? findKeyByConnectionId(...)` fallbacks in
  `useConnections/message-handlers.ts` and `useConnections/startup-prompts.ts`.
- Stopped emitting a broken `session-status-update` from `bus-event-forwarders`
  and changed `connectionId` fallbacks from `?? sessionID` to `?? null` so OC
  SSE events never fabricate a connection identity.
- Refactored `cancelActivePrompt` and `forceTerminateChat` to treat the
  argument as an opaque identity (no implicit connectionId routing).
- Restricted the `findKeyByConnectionId` and `findNodeBySessionId`
  connectionId-only fallback to nodes where
  `isDirectConnection || providerSessionId === null`.
- Extracted a pure `dismissStatus` helper (co-located test) so dismiss flows
  use the same restricted matcher.
- **Removed `tryAutoBindSession`, `recordPendingConnection`, the
  `_pendingConnections` map and `AUTO_BIND_WINDOW_MS` entirely.** With the
  post-Phase-6 contract requiring agents to pass `openCodeSessionId` on every
  call, the timestamp-based bind heuristic was both dead and a real
  data-corruption risk: when two subagents called `register_connection` within
  the bind window without a session id, the LIFO tiebreak could swap their
  MCP transports.

The notes below describe the _original_ plan; sections that mention the
auto-bind heuristic, `_pendingConnections`, or the connectionId-as-session-id
priority chain are now historical.

---

## 1. Motivation

### Why not just drop `openCodeSessionId` and use `connectionId`?

OpenCode uses a **shared MCP client** across all agent sessions in a project. When the main agent spawns a subagent via the Task tool or SDK:

- The subagent does **NOT** get its own MCP connection.
- All subagents multiplex through the same `connectionId` (the same HTTP transport session) as the parent.
- Routing a tool call to the correct channel requires the agent to identify which _session_ it is — `connectionId` alone cannot distinguish main from subagents.

This is not a legacy quirk — it is the current (post-SDK) behavior, confirmed by:

- `desktop/src/main/mcp-server.ts:652` — `sessionIdGenerator: () => randomUUID()` mints a new `connectionId` per MCP transport `initialize`, not per agent.
- `AGENTS.md` (authoritative): _"OpenCode uses a shared MCP client across all agent sessions. Without an explicit session ID on each tool call: parallel subagents cannot be distinguished from each other."_
- `desktop/src/main/session/tree-manager.ts:451-462` — `buildSessionBootstrapMessage` injects a `<system-reminder>` into every child session precisely because the shared MCP client cannot otherwise identify the subagent.

**Conclusion:** `openCodeSessionId` is still essential. It cannot be dropped.

### What actually needs to change

The problem is not the existence of two identifiers. The problem is **inconsistent keying** — different tables, maps, and sets use different keys, with `??` fallbacks glued between them. This creates:

| Symptom                                                                                       | Location                                                                                         |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Channel row keyed on `connectionId`, history row keyed on `openCodeSessionId ?? connectionId` | `session_channels` vs `session_channel_history`                                                  |
| Pending injections orphaned on transport reconnect                                            | `pending_context_injections.connection_id`                                                       |
| Stale-connection tombstone misses after reconnect                                             | `_deletedConnections: Set<connectionId>`                                                         |
| Deprecated `RegisteredConnection.openCodeSessionId` field that mirrors `providerSessionId`    | `database.ts`                                                                                    |
| Two racing auto-register paths reconciled with a 3-second window                              | `mcp-server.ts::autoRegisterDefaultConnection` vs `session/tree-manager.ts::autoRegisterSession` |
| Defensive `findNodeKeyWithFallback` in the renderer handling key-shape changes mid-session    | `store/message-dispatch.ts`                                                                      |

After the refactor, **one key** (`providerSessionId`) is used everywhere. All `??` fallbacks, all key-reshape logic, all deprecated aliases — removed.

---

## 2. Non-goals

- **Do NOT rename the MCP tool wire parameter.** Agents continue to pass `openCodeSessionId` on tool calls. This is the single concession to backwards compatibility — every deployed agent in the wild (OpenCode, Claude Code, docs, system-reminders) references that name.
- **Do NOT touch the CLI package** (`src/`). It has its own unrelated session ID model.
- **Do NOT add a data-migration step** for existing installs. Schema version bump to v11 wipes and recreates the DB (matches the existing pattern — see `database.ts:13-19`). Users lose channel history on upgrade (acceptable per one-shot migration decision).

---

## 3. Target architecture

### 3.1 Identity terminology

| Term                | Meaning                                                                                                                                                                                                | Where it lives                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `providerSessionId` | Canonical session identity. For OpenCode: the `ses_xxx` session ID. For Copilot CLI / Claude SDK / standalone: the MCP connectionId at first registration (captured as the session's stable identity). | Primary key across all tables, primary key in all in-memory maps, field on all IPC payloads.                                    |
| `connectionId`      | Transport handle. UUID minted by `StreamableHTTPServerTransport.sessionIdGenerator` on each MCP `initialize`. Ephemeral.                                                                               | Nullable column on `registered_connections`. Re-bound on reconnect via `updateConnectionId`. NEVER used as a key anywhere else. |
| `openCodeSessionId` | Public wire name on MCP tool parameters only. Internally resolved to `providerSessionId` at the tool-call boundary.                                                                                    | MCP tool input schemas, AGENTS.md, system-reminders.                                                                            |

### 3.2 Single-key invariant

```
IF you are reading from or writing to persistent state or an in-memory map
  THEN the key MUST be providerSessionId (composite with providerType in DB).

IF you are reading connectionId from anywhere other than
  (registered_connections.connection_id column) OR
  (a single resolver function that converts connectionId → providerSessionId)
  THEN you are violating the invariant.
```

### 3.3 Resolver contract

A single function at the MCP tool-call boundary:

```ts
// desktop/src/main/session/resolver.ts
function resolveProviderSessionId(
  connectionId: string,
  explicit: string | undefined | null,
  providerType: RegisteredConnection['providerType'],
): string | null;
```

Priority:

1. `explicit` (from tool param) — for OpenCode, agents always pass this; it wins.
2. DB lookup by `(connectionId)` — returns the `provider_session_id` of the row that transport is currently bound to.
3. `null` — caller handles the missing-session error.

Everything downstream of the tool handler deals ONLY in `providerSessionId` (+ `providerType`). The transport `connectionId` stops being plumbed through.

---

## 4. Execution plan — six phases

All phases land in one branch. Each phase ends with `npm run check-types` + `npm test -- --run` (inside `desktop/`) passing before moving to the next. Commits split on phase boundaries.

### Phase 1 — DB schema + `database.ts` types

**Files:**

- `desktop/src/main/database.ts`

**Changes:**

1. Bump `SCHEMA_VERSION` from `10` → `11`. On startup, `initDatabase` drops all tables and recreates (existing pattern). No per-row migration code.
2. `RegisteredConnection` interface:
   - **Remove** the deprecated `openCodeSessionId: string` field.
   - Keep `providerSessionId`, `connectionId: string | null`, and everything else.
3. `pending_context_injections` table:
   - Rename column `connection_id` → `provider_session_id` (TEXT NOT NULL).
   - Add column `provider_type` (TEXT NOT NULL, defaults to `'standalone'`).
   - Rebuild index `idx_pci_session_delivered` on `(provider_type, provider_session_id, delivered)`.
4. `session_channels.session_id` — no column change, but document that the stored key is **always** `providerSessionId` (never a connectionId).
5. Remove deprecated functions:
   - `getRegisteredConnectionByOpenCodeSessionId` → delete.
   - `isOpenCodeSessionClaimed` → delete.
   - `updateConnectionOpenCodeSession` → delete.
6. Rewrite `mapRowToRegisteredConnection` — drop the `openCodeSessionId: providerSessionId` mirror line.
7. Rewrite `upsertRegisteredConnection`:
   - Drop the `openCodeSessionId?` input field. Input is `providerSessionId` (required) only.
   - Drop the `??` fallback chain.
   - Drop the `openCodeSessionId: providerSessionId` line in the ID file JSON (breaking; ID files are ephemeral in `/tmp`, fine on a schema bump).
8. Rewrite `{upsert,claim,deleteContextInjectionsForConnection}ContextInjection` signatures:
   - Take `providerSessionId: string, providerType: RegisteredConnection['providerType']` instead of `connectionId: string`.
   - Internal queries hit the new columns.
9. `getActiveSessionChannels` — rename the returned field `openCodeSessionId` → `providerSessionId`. The SQL JOIN stays (it already joins on `rc.provider_session_id = sc.session_id`, which is correct under the new invariant).

**Exit criteria:**

- `tsc --noEmit` in `desktop/` compiles `database.ts` only (other files still call the old signatures — they break in later phases).
- Existing tests that touch `database.ts` are updated to the new API.

### Phase 2 — In-memory state rekey

**Files:**

- `desktop/src/main/ipc/prompt.ts`
- `desktop/src/main/connection-guard.ts` (moved from tools if needed)
- `desktop/src/main/claude-sdk-runtime.ts`
- `desktop/src/main/session/tree-manager.ts` (partial — `_pendingConnections` and `_deletedConnections` collections)

**Changes:**

1. `activePrompts: Map<string, ...>` in `ipc/prompt.ts` — key becomes `providerSessionId`. Remove the `promptKey = openCodeSessionId ?? connectionId` computation. Callers must supply `providerSessionId`.
2. `_deletedConnections: Set<string>` — rename to `_deletedSessions`, key on `providerSessionId`. Update `staleConnectionError` accordingly (rename to `staleSessionError`).
3. `claudeSessionByConnectionId: Map<string, string>` in `claude-sdk-runtime.ts` — invert to `claudeSessionByProviderSessionId: Map<providerSessionId, claudeSessionId>`. All callers go through the DB-lookup once at the boundary, then use `providerSessionId` thereafter.
4. `_pendingConnections: Map<string, number>` in `tree-manager.ts` — currently keyed on `connectionId` for the auto-bind window. Keep `connectionId` here **only** because the purpose of this map is explicitly "transport-waiting-to-be-bound-to-a-session". It is the one place `connectionId` is legitimately a key. Document this.

**Exit criteria:**

- No `??` fallback involving `connectionId` and `openCodeSessionId` anywhere in the main process (grep check).
- `activePrompts.get(providerSessionId)` is the only lookup shape.
- Tests updated and passing.

### Phase 3 — Tool layer + resolver cleanup

**Files:**

- `desktop/src/main/session/resolver.ts`
- `desktop/src/main/ipc/channel.ts`
- `desktop/src/main/tools/connection-guard.ts`
- `desktop/src/main/tools/register-connection.ts`
- `desktop/src/main/tools/request-user-input.ts`
- `desktop/src/main/tools/session-channel.ts`
- `desktop/src/main/tools/intensive-chat.ts`
- `desktop/src/main/tools/poll-context-injections.ts`
- `desktop/src/main/tools/find-repo-docs.ts`

**Changes:**

1. `resolver.ts`:
   - Replace `resolveOpenCodeSessionId(connectionId, explicit)` with `resolveProviderSessionId(connectionId, explicit, providerType)`.
   - The 4-priority chain collapses to 3 (drop priority #3 — "treat connectionId as an openCodeSessionId" — that was a compatibility hack that is no longer needed because `_pendingConnections` + SSE auto-bind is the source of truth).
   - `resolveSession` function: change all internal references from `record.openCodeSessionId` → `record.providerSessionId`.
2. `ipc/channel.ts::sendToRenderer`:
   - Signature change: `sendToRenderer(win, channel, providerSessionId, payload)` — drop the `connectionId` and `explicitSessionId` params.
   - IPC payload shape: `{ providerSessionId, ...payload }` — drop the dual-emit `{connectionId, openCodeSessionId}`.
3. `connection-guard.ts`:
   - Merge `missingSessionIdError` (DB-side check) and `missingSessionIdParamError` (param-side check) into one helper: `requireProviderSessionId(connectionId, explicit, providerType) → { ok, providerSessionId } | { ok: false, errorResponse }`.
   - Rename `staleConnectionError` → `staleSessionError`, takes `providerSessionId`.
4. `register-connection.ts`:
   - Remove `createSessionChannel(connectionId, ...)` — replace with `createSessionChannel(providerSessionId, ...)`.
   - Remove `effectiveSessionId = openCodeSessionId ?? connectionId` logic. The tool input still takes `openCodeSessionId?` (wire name), but internally immediately resolves to `providerSessionId` via `resolveProviderSessionId` or `autoDetectOpenCodeSession`. If neither produces a value for OpenCode, return an error asking the agent to pass it.
   - For non-OpenCode providers, `providerSessionId = connectionId` remains the convention (captured at registration time, stable thereafter).
5. All other tools (`request_user_input`, `push_session_status`, `send_message`, `start/ask/stop_intensive_chat`, `poll_context_injections`, `find_repo_docs`):
   - Keep the MCP input schema parameter name `openCodeSessionId` (public wire).
   - First line of each handler: `const providerSessionId = requireProviderSessionId(connectionId, openCodeSessionId, providerType)` → use `providerSessionId` only from there on.

**Exit criteria:**

- No tool handler reads `connectionId` past the first resolver call.
- `sendToRenderer` callers all pass `providerSessionId`; IPC payload is `{providerSessionId, ...}` only.
- Tests updated and passing.

### Phase 4 — Auto-register race consolidation

**Files:**

- `desktop/src/main/mcp-server.ts`
- `desktop/src/main/session/tree-manager.ts`

**Changes:**

1. Make **SSE the single source of truth** for OpenCode auto-registration. `session.created.1` → `autoRegisterSession` inserts the row with `connection_id = NULL` (not fake-equal-to-session-id).
2. `mcp-server.ts::autoRegisterDefaultConnection`:
   - If provider is `opencode` and `autoDetectOpenCodeSession` finds a session → call `updateConnectionId(providerSessionId, connectionId)` to **bind** the transport to the existing (SSE-created) row. Do NOT create a new row.
   - If no SSE row exists yet (cold start race): insert a row with the detected `providerSessionId` directly; SSE handler will deduplicate on `(providerType, providerSessionId)` thanks to `ON CONFLICT`.
3. `tree-manager.ts::autoRegisterSession`:
   - Change `connection_id = info.id` (line ~500-ish) → `connection_id = NULL`.
   - Keep `_pendingConnections` + `tryAutoBindSession` logic — but it now does `updateConnectionId(providerSessionId, connectionId)` on the SSE-created row to bind the waiting transport.
4. Resolver priority #3 ("connectionId might be an openCodeSessionId") can be fully deleted in this phase — the hack is no longer reachable because we never set `connectionId = sessionId` anymore.

**Exit criteria:**

- No row in `registered_connections` ever has `connection_id == provider_session_id` (invariant check in a test).
- Cold-boot, hot-reload, and subagent-spawn scenarios all pass existing tests + new tests for the race window.

### Phase 5 — Renderer simplification

**Files:**

- `desktop/src/renderer/src/types.ts`
- `desktop/src/renderer/src/store/message-dispatch.ts`
- Any component that reads `SessionNode.openCodeSessionId` or `SessionNode.connectionId` separately.

**Changes:**

1. `SessionNode` type: single field `providerSessionId: string`. Drop separate `openCodeSessionId` and (where used as identity) `connectionId` fields.
2. The session-node `Map<string, SessionNode>` keys on `providerSessionId`. Drop `?? connectionId` fallback.
3. `resolvePromptTarget` collapses to `prompt.providerSessionId → node`.
4. `resolveTargetBySessionId` → single direct map lookup.
5. Delete `findNodeKeyWithFallback` (defensive key-reshape code).
6. IPC listeners consume `{providerSessionId, ...}` payloads only.

**Exit criteria:**

- Renderer renders correctly for cold-boot, multi-subagent, parent/child trees, and reconnects.
- No `??` fallback involving connectionId in renderer.
- Tests updated and passing.

### Phase 6 — Docs + test cleanup

**Files:**

- `AGENTS.md`
- `desktop/docs/ARCHITECTURE.md`
- `desktop/docs/DATABASE.md`
- `desktop/docs/TOOLS.md`
- `desktop/docs/SESSION-CHANNELS.md`
- `desktop/docs/IPC-API.md`
- `desktop/docs/PROVIDER-SESSION-ID-UNIFICATION-PLAN.md` → move to `archive/` once executed.

**Changes:**

1. Update schema version references from 9/10 → 11 (ARCHITECTURE currently says 9, DATABASE may say 10).
2. `AGENTS.md` — keep the agent-facing narrative about passing `openCodeSessionId` on every call. Update the "Key Architectural Decisions" section to state that internally the key is `providerSessionId`. Remove the line claiming `openCodeSessionId` is the DB primary key; update to `(providerType, providerSessionId)`.
3. `TOOLS.md` — no wire-API changes. Refresh examples only.
4. `SESSION-CHANNELS.md` — update the keying narrative: `session_channels.session_id` is always `providerSessionId`.
5. `IPC-API.md` — update payload shapes (drop `connectionId` + `openCodeSessionId` dual emission; replace with `providerSessionId`).
6. Sweep any remaining test file that still uses deprecated function names or fields.

**Exit criteria:**

- All 427 desktop tests pass (count may shift as tests are added/removed — fine, as long as the suite is green).
- `npm run check-types` at repo root passes.
- `desktop/npm run build` passes (electron-vite).
- Docs consistent with code.

---

## 5. Breaking changes surface

| Audience                          | Impact                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| End users (desktop app)           | On first launch after upgrade, the local SQLite DB is wiped (schema v10 → v11). Channel history, pending injections, and registered connections reset. Same UX as prior schema bumps.                                                                                                                                                         |
| AI agents using MCP tools         | **Zero wire-protocol change.** Tool parameter name remains `openCodeSessionId`. Agents do not need to be updated.                                                                                                                                                                                                                             |
| Developers extending the codebase | `RegisteredConnection.openCodeSessionId` field removed — use `providerSessionId`. Deprecated helper functions (`getRegisteredConnectionByOpenCodeSessionId`, `isOpenCodeSessionClaimed`, `updateConnectionOpenCodeSession`) removed. `sendToRenderer` signature changed. `resolveOpenCodeSessionId` replaced with `resolveProviderSessionId`. |
| Docs                              | AGENTS.md and `desktop/docs/*` updated in Phase 6.                                                                                                                                                                                                                                                                                            |

---

## 6. Risk register

| Risk                                                                         | Likelihood | Mitigation                                                                                                                                                 |
| ---------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer listeners miss payload reshape and UI shows stale/wrong channel     | Medium     | Phase 5 runs its full test suite; manual smoke of multi-subagent scenario.                                                                                 |
| Auto-register race regresses after consolidation (Phase 4)                   | Medium     | Preserve the `_pendingConnections` bind window; add targeted unit tests for cold-boot, warm-boot, parent-first, and child-first SSE orders.                |
| A forgotten caller of a deleted deprecated function causes runtime crash     | Low        | Phase-by-phase `tsc` gates catch most. Grep for removed function names before each commit.                                                                 |
| Claude SDK path regresses (its own in-memory map is inverted)                | Low-Medium | Claude SDK has dedicated tests; run them specifically after Phase 2.                                                                                       |
| pending_context_injections in-flight for Copilot CLI users breaks on upgrade | Low        | Schema wipe drops them. Copilot CLI users who relied on cross-restart persistence will need to re-send — acceptable given the one-shot migration decision. |

---

## 7. Estimated scope

| Metric                         | Estimate                         |
| ------------------------------ | -------------------------------- |
| Main-process files touched     | ~15                              |
| Renderer files touched         | ~8–10                            |
| Test files updated or added    | ~30–50                           |
| Docs updated                   | 6                                |
| Commits                        | 6 (one per phase)                |
| Schema migration               | 1 (v10 → v11, wipe-and-recreate) |
| Breaking wire-protocol changes | **0**                            |

---

## 8. Acceptance checklist (run before merging)

- [ ] `cd desktop && npm run check-types` — clean.
- [ ] `cd desktop && npm test -- --run` — all tests pass.
- [ ] `cd desktop && npm run build` — clean.
- [ ] `npm run check-types` at repo root — clean.
- [ ] Manual smoke in `npm run dev`:
  - [ ] Cold start, no sessions.
  - [ ] Single OpenCode session registers and shows in sidebar.
  - [ ] Parent spawns subagent via Task tool; subagent appears as child, tool calls route correctly.
  - [ ] Parallel subagent spawn (two Task tool calls simultaneously); each routes to its own channel.
  - [ ] Kill + restart desktop app; sidebar re-hydrates from SSE.
  - [ ] Delete a channel from sidebar; agent re-calls `register_connection`; new channel appears.
  - [ ] Copilot CLI / Claude SDK mode still works (registration, messaging, intensive chat).
- [ ] No file contains `openCodeSessionId ?? connectionId` or similar fallback.
- [ ] No code outside `database.ts::mapRowToRegisteredConnection` + the resolver reads a row's `connection_id` column.
- [ ] Grep confirms `openCodeSessionId` appears only as: (a) tool input parameter name, (b) agent-facing docs/reminders, (c) historical references in changelogs.

---

## 9. Out-of-scope follow-ups (later)

- Rename the wire parameter `openCodeSessionId` → `providerSessionId` behind a feature flag, with a one-release deprecation window and system-reminder updates.
- Extract a `providerSessionKey` branded type (`type ProviderSessionKey = string & { __brand }`) to make the invariant compiler-enforceable.
- Revisit `_pendingConnections` now that SSE is the sole creator — may be collapsible into a simpler "last-unbound-transport" single slot.
