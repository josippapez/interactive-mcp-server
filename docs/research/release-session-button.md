# Close/Release-Session Button — Feasibility Report

Research-only. No files modified.

## 1. Channel header — file & button slots

**File:** `desktop/src/renderer/src/components/prompt/ChannelHeader.tsx`

The header already owns an action toolbar starting at `ChannelHeader.tsx:215`. Existing icon buttons, in left-to-right order:

| #   | Button                                     | Prop                                   | Lines   |
| --- | ------------------------------------------ | -------------------------------------- | ------- |
| 1   | Search toggle                              | `onSearchOpenChange`                   | 216–249 |
| 2   | Abort running session                      | `onAbortSession` (gated by `canAbort`) | 251–276 |
| 3   | Expand/collapse all tools                  | `onToggleExpandAllTools`               | 277–330 |
| 4   | Copy transcript                            | `onCopyTranscript`                     | 331–388 |
| 5   | Toggle thinking                            | `onToggleShowThinking`                 | 389–432 |
| 6   | Text-size control                          | `onChatTextSizeChange`                 | 433–458 |
| 7   | Full-width toggle                          | `onToggleChatFullWidth`                | 459–510 |
| 8   | **Clear message history**                  | `onClearMessages`                      | 511–539 |
| 9   | **Close tab from UI (dismiss)**            | `onDismissSession`                     | 540–564 |
| 10  | **Remove channel permanently** (red trash) | `onRemoveSession`                      | 565–595 |

A new **Release memory** button slots naturally between #8 and #9 — conceptually sitting between "clear messages, keep session" and "close tab, keep channel row". `ConfirmDeleteModal`/`ConfirmAbortModal` (imported at `:4–5`, rendered at `:686–703`) give a reusable confirmation pattern.

**Prop wiring path (renderer):**
`PromptView.tsx:94–96` → `usePromptViewState.ts:32–34, 166–200` → `useConnections/session-handlers.ts:11–28` → `window.api.dismissSession / removeSessionChannel`.

## 2. Session lifecycle in main — what each existing path does

Three "close-ish" IPC paths already exist and are cleanly distinct:

### (a) `dismissSession` — UI-only "close tab"

- Preload: `desktop/src/preload/api/sessions.ts:41–42`
- Handler: `desktop/src/main/ipc/handlers/system-handlers.ts:160–164`
- Effect: calls `forceTerminateChat(connectionId)` (cancels pending prompts) and emits `connection-closed`. **No DB mutation, no MCP transport close, no upstream action.** Renderer drops the `SessionNode` from its `Map`.

### (b) `clearSessionChannelMessages` — wipe transcript

- Handler: `desktop/src/main/ipc/handlers/session-channel-handlers.ts:77–86`
- Effect: deletes `session_channel_messages` DB rows; emits `session-channel-messages-cleared`. Node survives.

### (c) `removeSessionChannel` — permanent delete (red trash)

- Handler: `desktop/src/main/ipc/handlers/session-channel-handlers.ts:87–100`
- Orchestrator: `desktop/src/main/remove-persisted-session.ts:48–107`
- Full teardown sequence:
  1. `forceTerminateChat(sessionId)` (`ipc/prompt.ts:308–328`) — cancels active prompts
  2. `closeSessionByConnectionId(sessionId)` (`mcp-server.ts:676→116–137`) — closes MCP `server` + `transport`, removes from in-memory `sessions` map
  3. `deleteSessionChannel`, `deleteRegisteredConnection` — DB rows gone
  4. `markSessionDeleted(providerSessionId)` (`tools/connection-guard.ts:17`) — in-memory tombstone; future tool calls by that agent return structured `SESSION_REMOVED` error
  5. `clearSessionAttachments` — wipes tmpdir attachments
  6. `tombstoneOpenCodeSession(providerSessionId)` (`session/session-tree-service.ts:104`) — blocks SSE re-add
  7. `invalidateSessionTree()`; emits `connection-closed` + `session-channel-deleted`

**Not done anywhere:** no call to OpenCode's `DELETE /session/{id}`. The upstream session keeps running.

## 3. RAM-relevant per-session structures

| Location | Structure                                                                                           | File:line                                                                      | Freed by                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| main     | `sessions[sid] = { server, transport, connectionId, providerType, connectionName }`                 | `mcp-server.ts:87` (map), `:116–137` (cleanup)                                 | `closeSessionByConnectionId`                                                                                             |
| main     | `activePrompts: Map<string, DurablePromptState>`                                                    | `ipc/prompt.ts:105`; cancel `:260–273`; force-terminate `:308–328`             | `cancelActivePrompt` / `forceTerminateChat`                                                                              |
| main     | Session-tree cache + tombstones                                                                     | `session/session-tree-service.ts:56–65`                                        | tombstone add (no eviction)                                                                                              |
| main     | `_deletedSessions: Set<string>` (unbounded process-scoped growth)                                   | `tools/connection-guard.ts:14`                                                 | never (reset on app restart)                                                                                             |
| main DB  | `session_channel_messages`, `context_injections`, `registered_connections`, `session_channels` rows | `database.ts`                                                                  | `deleteSessionChannel`, `clearSessionChannelMessages`, `deleteRegisteredConnection`, `deleteContextInjectionsForSession` |
| main     | Attachment files under `os.tmpdir()`                                                                | `attachment-store.ts`                                                          | `clearSessionAttachments`                                                                                                |
| renderer | `SessionNode.channelMessages: ChannelMessage[]` (dominant heap)                                     | `types.ts:167`; mutated in `useConnections/message-handlers.ts:80–90, 167–190` | `setNodes` immutable replace                                                                                             |
| renderer | `sessionStatuses`, `pendingPermissions`, `pendingQuestions`                                         | `types.ts:185–191`                                                             | same                                                                                                                     |
| renderer | React Query cache for `get-session-channel-history`                                                 | `useConnections/channel-history.ts`                                            | query invalidation                                                                                                       |

**Dominant growth (biggest wins for a "release" button), in order:**

1. Renderer `channelMessages` arrays (tool-call payloads + thinking text).
2. SQLite mirror of `session_channel_messages`.
3. `sessionStatuses` + pending-permission arrays.
4. MCP `server` + `transport` pair per active agent.
5. Attachment paths (cheap — bytes live on disk).

## 4. Relationship to OpenCode upstream

- **No existing desktop path kills the upstream session.** `removePersistedSession` does not call OpenCode's delete endpoint.
- OpenCode has the capabilities:
  - Delete: `sessionDelete(port, sessionID)` — `desktop/src/main/opencode/session-api.ts:276–284` (wraps `client.session.delete`).
  - Abort running run: `abortOpenCodeSession(sessionId)` — `desktop/src/main/opencode/abort.ts:31` (POST `/session/{id}/abort`). Already used by header button #2.
- So today: "close in desktop app" = desktop-side only; OpenCode session keeps living (and keeps consuming OpenCode-process RAM, which is out of scope of this app).

**Design question this forces:** should the new button (a) release desktop-side resources only, (b) also abort the upstream run, or (c) DELETE the upstream session? See UX recommendation in §7.

## 5. DB persistence & reversibility

| Operation                     | DB rows kept?                                        | Reversible?                                                          |
| ----------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| `dismissSession`              | All kept                                             | Yes — next SSE `session.updated`/`session.created` or sidebar reopen |
| `clearSessionChannelMessages` | `session_channel_messages` deleted; channel row kept | No for messages                                                      |
| `removeSessionChannel`        | All rows deleted + tombstoned                        | Not via auto-register; agent gets `SESSION_REMOVED` error            |

For a "release memory" button that stays reversible: keep `session_channels` + `registered_connections` rows, delete `session_channel_messages` + `context_injections`, evict renderer state, do NOT tombstone, do NOT `markSessionDeleted`. The channel reappears empty and the agent can continue using its tools (transparent MCP reinit handles transport rebind).

## 6. Existing sidebar "delete channel" flow — contrast

The red trash at `ChannelHeader.tsx:565–595` + `ConfirmDeleteModal` routes to `removePersistedSession` — the **permanent delete** path. Per AGENTS.md and `connection-guard.ts:26–55`, deletion returns `SESSION_REMOVED` to any agent that tries to use the session afterwards.

The proposed Release button **must not** use this path — it should not tombstone, must not `markSessionDeleted`, and must leave `registered_connections` intact. Otherwise it turns into another flavor of permanent delete and breaks running agents.

## 7. UX recommendation

Three candidate semantics:

| Option                              | Verb                                         | What it does                                                                                                                                                                                                                                                                      | Reversibility                                                                                                                                                |
| ----------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. Release memory (recommended)** | "Release" / "Unload"                         | Close MCP transport + cancel prompts + clear renderer `channelMessages` + delete `session_channel_messages` + clear context_injections + clear attachments. Keep `session_channels` + `registered_connections` rows; **no tombstone, no upstream delete, no markSessionDeleted**. | Yes — SSE `session.updated` or any subsequent tool call re-hydrates an empty channel; agent keeps working via transparent MCP reinit (`mcp-server.ts:265+`). |
| B. Archive                          | As A + `archived=1` flag + hide from sidebar | Yes (via "show archived" toggle) — but adds schema migration, new filter UI, settings toggle.                                                                                                                                                                                     |
| C. Close desktop + upstream         | As A + call `sessionDelete` on OpenCode      | No                                                                                                                                                                                                                                                                                |

**Recommended: Option A — "Release memory".** Matches the stated goal (free RAM as sessions accumulate), reversible, does not orphan agents mid-run, cleanly separates from the permanent-delete path. Label: **Release memory** with a snowflake/unload icon. The red trash retains its "permanent delete" role.

- Rationale vs. B: over-engineered for the RAM goal; defer unless users explicitly request archive semantics.
- Rationale vs. C: users who want upstream gone already have the trash button; adding an optional "also delete upstream" checkbox to the _existing_ trash confirm modal is a cleaner future follow-up than conflating it into Release.

## 8. Auto-registration re-entry (non-stickiness of Release)

With Option A (no tombstone, `registered_connections` row kept):

- `autoRegisterSession` (`session/auto-register.ts:78–148`) checks `isProviderSessionClaimed` at `:83`. Because the registered row remains, `alreadyClaimed=true` → early return at `:91–93`. **No duplicate row, no loop.**
- Next tool call by the agent: `staleSessionError` (`connection-guard.ts:26–55`) returns `null` (session wasn't marked deleted), tool call proceeds. The MCP transport was closed, but `handleTransparentReinit` in `mcp-server.ts:265+` silently re-creates a session on the next request; agent sees no error.
- Renderer node rebuilds on next `get-persisted-session-channels` fetch or session-tree refresh.

Only rebinding concern: `connection_id` in `registered_connections` gets a new MCP transport handle after transparent reinit — `autoRegisterDefaultConnection` already rebinds this on MCP `initialize`.

**Conclusion: Release is intentionally non-sticky and safe.**

## 9. IPC wiring plan

Per `desktop/docs/IPC-API.md:133` patterns and the `add-ipc-handler` skill:

| Layer                   | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main orchestrator (new) | `desktop/src/main/release-persisted-session.ts` — sibling of `remove-persisted-session.ts`. Executes: `forceTerminateChat` → `closeSessionByConnectionId` → `clearSessionChannelMessages` → `deleteContextInjectionsForSession(providerSessionId, providerType)` → `clearSessionAttachments` for both `providerSessionId` and `sessionId`. Emits new `session-channel-released` event (or reuses `session-channel-messages-cleared`). Does NOT touch: `deleteSessionChannel`, `deleteRegisteredConnection`, `markSessionDeleted`, `tombstoneOpenCodeSession`. |
| Main IPC handler        | `desktop/src/main/ipc/handlers/session-channel-handlers.ts` — register `release-session-memory` near existing `remove-session-channel` (`:87–100`).                                                                                                                                                                                                                                                                                                                                                                                                           |
| Preload                 | `desktop/src/preload/api/sessions.ts` — add `releaseSessionMemory(sessionId: string): Promise<boolean>` (mirrors `removeSessionChannel` at `:61–62`).                                                                                                                                                                                                                                                                                                                                                                                                         |
| Renderer hook           | `desktop/src/renderer/src/hooks/useConnections/session-handlers.ts` — add `handleReleaseSession`. **Must also** immediately reset `node.channelMessages = []`, `sessionStatuses = []`, `pendingPermissions = []`, `pendingQuestions = []`, `unreadCount = 0` via `setNodes` so renderer heap drops without awaiting IPC round-trip (mirror `handleClearChannelMessages` in `useConnections/message-handlers.ts:207`).                                                                                                                                         |
| Renderer hook barrel    | `useConnections/useConnections.ts` — export `handleReleaseSession`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| View types              | `desktop/src/renderer/src/pages/prompt/prompt-view-types.ts` — add `onReleaseSession: (sessionId: string) => Promise<boolean>`.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| View state              | `usePromptViewState.ts` — thread prop, add `releaseError` + confirm-modal state mirroring `confirmDelete` pattern (`:166–200`).                                                                                                                                                                                                                                                                                                                                                                                                                               |
| PromptView              | `desktop/src/renderer/src/pages/PromptView.tsx:94–96` — wire prop.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| App root                | `desktop/src/renderer/src/App.tsx:49–53, 183–187` — wire prop.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ChannelHeader           | Add `onReleaseSession` prop, new icon button between #8 and #9, new `ConfirmDialog` usage ("Release memory? Clears the transcript locally but keeps the session available on OpenCode.").                                                                                                                                                                                                                                                                                                                                                                     |
| Docs                    | Append row to `desktop/docs/IPC-API.md` for `releaseSessionMemory`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## 10. Tests

Add to `desktop/`:

- **`desktop/src/main/release-persisted-session.test.ts` (new)** — unit-tests the orchestrator with mocked deps, asserts it (a) cancels prompts, (b) closes MCP transport, (c) clears message + context-injection + attachment state, (d) **does NOT** call `deleteSessionChannel` / `deleteRegisteredConnection` / `markSessionDeleted` / `tombstoneOpenCodeSession`, (e) emits the expected renderer event. Pattern mirrors the existing implicit contract of `remove-persisted-session.ts` (no current test file covers it — add one here as a bonus).
- **Renderer hook test** — verify `handleReleaseSession` calls `window.api.releaseSessionMemory` and locally zeroes `channelMessages` via a `setNodes` reducer. Reuse the setup in `useConnections/persisted-session-channels.test.ts`.
- **Re-entry regression test** — simulate SSE `session.updated` for a just-released session; assert `autoRegisterSession` short-circuits because the `registered_connections` row still exists (`alreadyClaimed=true`).

Estimated test LOC: ~120. All 427 existing tests should remain green.

---

## File:line index (investigation anchors)

- Channel header component: `desktop/src/renderer/src/components/prompt/ChannelHeader.tsx:215` (toolbar start), `:511–595` (clear/dismiss/remove)
- Dismiss handler: `desktop/src/main/ipc/handlers/system-handlers.ts:160`
- Remove handler: `desktop/src/main/ipc/handlers/session-channel-handlers.ts:87`
- Remove orchestrator: `desktop/src/main/remove-persisted-session.ts:48`
- MCP session cleanup: `desktop/src/main/mcp-server.ts:87` (sessions map), `:116` (per-session cleanup), `:676` (exported), `:149–193` (clear-all)
- Prompt state + cancel: `desktop/src/main/ipc/prompt.ts:105, 260, 308`
- Tombstone: `desktop/src/main/session/session-tree-service.ts:104`
- Stale-session guard: `desktop/src/main/tools/connection-guard.ts:14, 17, 26`
- Auto-register (SSE): `desktop/src/main/session/auto-register.ts:78–148`
- Upstream abort / delete: `desktop/src/main/opencode/abort.ts:31`, `desktop/src/main/opencode/session-api.ts:276`
- Renderer `SessionNode` shape: `desktop/src/renderer/src/types.ts:115–202`
- Renderer session handlers: `desktop/src/renderer/src/hooks/useConnections/session-handlers.ts:11–28`
- Renderer message handlers: `desktop/src/renderer/src/hooks/useConnections/message-handlers.ts:207`
- Preload surface: `desktop/src/preload/api/sessions.ts:41, 59, 61`
- IPC docs table: `desktop/docs/IPC-API.md:133`

## Concrete implementation plan (files + rough LOC)

| File                                                                | Change                                                    | LOC |
| ------------------------------------------------------------------- | --------------------------------------------------------- | --- |
| `desktop/src/main/release-persisted-session.ts` (new)               | Orchestrator sibling of `remove-persisted-session.ts`     | ~70 |
| `desktop/src/main/ipc/handlers/session-channel-handlers.ts`         | New `release-session-memory` handler                      | ~15 |
| `desktop/src/preload/api/sessions.ts`                               | Add `releaseSessionMemory` method                         | ~3  |
| Preload types (if separate)                                         | Extend `window.api` type                                  | ~2  |
| `desktop/src/renderer/src/hooks/useConnections/session-handlers.ts` | `handleReleaseSession` + local state reset via `setNodes` | ~20 |
| `desktop/src/renderer/src/hooks/useConnections/useConnections.ts`   | Export `handleReleaseSession`                             | ~3  |
| `desktop/src/renderer/src/pages/prompt/prompt-view-types.ts`        | Add `onReleaseSession` prop                               | ~2  |
| `desktop/src/renderer/src/pages/prompt/usePromptViewState.ts`       | Thread prop + confirm-modal state                         | ~15 |
| `desktop/src/renderer/src/pages/PromptView.tsx`                     | Wire prop                                                 | ~2  |
| `desktop/src/renderer/src/App.tsx`                                  | Wire prop                                                 | ~2  |
| `desktop/src/renderer/src/components/prompt/ChannelHeader.tsx`      | New icon button + confirm modal                           | ~45 |
| `desktop/src/main/release-persisted-session.test.ts` (new)          | Unit test                                                 | ~90 |
| Renderer hook test addition                                         | Verify handler + setNodes reset                           | ~30 |
| `desktop/docs/IPC-API.md`                                           | Add row                                                   | ~1  |

**Total ≈ 300 LOC of net additions, 0 deletions, 13 files.**

## Risks

1. **Data loss (transcript).** `channelMessages` deletion is irreversible. Mitigation: explicit copy in the confirm modal ("This clears the transcript locally but keeps the session available on OpenCode"). Keep the label distinct from button #8 "Clear message history" — Release additionally closes the MCP transport and evicts renderer heap; Clear only wipes DB rows.
2. **Upstream OpenCode session orphaning.** Release does not kill the upstream session. Users who expect "close = kill" will be surprised. Mitigation: label **"Release memory (keeps OpenCode session)"**. Optional future add: an "Also abort upstream run" secondary checkbox wired to `abortOpenCodeSession`.
3. **Re-auto-registration loop.** Mitigated by keeping the `registered_connections` row (see §8). A regression test must cover: SSE `session.updated` arriving after release does NOT create a duplicate row.
4. **Renderer-heap leak surviving release.** If any subscription or memoized selector still holds the pre-release `SessionNode`, GC cannot reclaim `channelMessages`. Mitigation: follow the immutable `setNodes` pattern from `handleClearChannelMessages` (`useConnections/message-handlers.ts:207`) — replace the entire node object, not mutate the array.
5. **Pending prompt aborted mid-run.** `forceTerminateChat` sends timeout/abort to any waiting agent. Mitigation: disable the Release button (or show an explicit warning) when `node.hasPendingPrompt || node.prompt` — mirrors the `canAbort` gate for button #2.
6. **SQLite rebuild cost.** Mass deletes rewrite the in-memory DB image; already handled acceptably by existing `clearSessionChannelMessages`. No new issue.
7. **`_deletedSessions` is NOT involved** — ensure the implementation does not accidentally call `markSessionDeleted`; otherwise the agent's next tool call returns `SESSION_REMOVED` and Release becomes indistinguishable from permanent delete. Covered by unit test (§10).
8. **Attachment URL staleness.** Cleared attachments remain referenced by transcript entries _if_ messages survived — but we clear messages too, so no dangling references.

## Effort estimate

**Medium (M).** Net ≈ 300 LOC across 13 files plus two test files. No new architectural concepts — pure composition of existing primitives: `forceTerminateChat`, `closeSessionByConnectionId`, `clearSessionChannelMessages`, `deleteContextInjectionsForSession`, `clearSessionAttachments`. Realistic window: half a day to one day for a single engineer including tests, excluding packaging/release.
