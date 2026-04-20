# Skills & Instructions Injection

## Overview

This document describes, end-to-end, how DB-stored skills and instructions flow from the Electron app's SQLite store into an OpenCode agent's context. The subsystem makes the desktop app **self-documenting for agents**: any skill or instruction the user registers (via the UI or via the `manage_skills_and_instructions` MCP tool) is automatically delivered to every active OpenCode session as a `<system-reminder>` block that OpenCode replays on every model step.

---

## Storage layer

All entries live in the `skills_and_instructions` SQLite table. See [`DATABASE.md`](./DATABASE.md) for the authoritative schema. Columns used by the injection pipeline:

| Column        | Role in injection                                                                       |
| ------------- | --------------------------------------------------------------------------------------- |
| `name`        | Unique key. Emitted in `<name>` and referenced by `manage_skills_and_instructions get`. |
| `type`        | `'skill'` \| `'instruction'` — routes the entry to the correct XML block.               |
| `description` | Short summary, always inlined (both skills and instructions).                           |
| `content`     | Full Markdown body. Inlined verbatim for instructions; fetched on demand for skills.    |
| `enabled`     | Only `true` rows are injected.                                                          |
| `is_builtin`  | Informational; does not gate injection.                                                 |
| `category`    | UI/organizational metadata; not used in the wire message.                               |
| `tags`        | UI/organizational metadata; not used in the wire message.                               |
| timestamps    | `created_at` / `updated_at`; not used in the wire message.                              |

CRUD is exposed through the `manage_skills_and_instructions` MCP tool (main-process implementation at [`desktop/src/main/tools/manage-skills-and-instructions.ts`](../src/main/tools/manage-skills-and-instructions.ts); see [`TOOLS.md`](./TOOLS.md#manage_skills_and_instructions)).

---

## Injection triggers

DB entries reach an agent's context in exactly four ways:

### a) Explicit `register_connection` MCP call

- Entry point: [`desktop/src/main/tools/register-connection.ts`](../src/main/tools/register-connection.ts) builds the startup-context message from `listSkillsAndInstructions()` and calls `startStartupContextInjection` (`register-connection.ts:205-222`).
- Background runner: `startStartupContextInjection` in [`desktop/src/main/tools/register-connection-background.ts`](../src/main/tools/register-connection-background.ts) (`register-connection-background.ts:176`) performs the actual `injectOpenCodeMessage` call when the backend supports provider injection and a session ID is known.

### b) MCP transport (re)connect auto-register

- Entry point: [`desktop/src/main/mcp-server/auto-register.ts`](../src/main/mcp-server/auto-register.ts) calls `maybeInjectDbContextOnConnect` in two places (`auto-register.ts:97` resume path, `auto-register.ts:121` first-connect path).
- Implementation: `maybeInjectDbContextOnConnect` in [`desktop/src/main/tools/db-context-injection.ts`](../src/main/tools/db-context-injection.ts) (`db-context-injection.ts:100`).
- Purpose: closes the gap when an agent never calls `register_connection`, and re-injects after an OpenCode session **resume** (resumed steps do not replay prior `system` injections — see [Wire delivery](#wire-delivery)).

### c) Post-CRUD change reminder

- Entry point: `broadcastSkillsChanged` in [`manage-skills-and-instructions.ts`](../src/main/tools/manage-skills-and-instructions.ts) (`manage-skills-and-instructions.ts:30`), invoked after every `register` (`:242`) and `delete` (`:379`) action.
- Message builder: `buildSkillsChangedReminder` in [`startup-context.ts`](../src/main/tools/startup-context.ts) (`startup-context.ts:131`).
- Targets: every active OpenCode session returned by `getRegisteredConnectionsByProvider('opencode')` and filtered through `pickReminderTargets`.

### d) SSE tree-manager auto-register of newly-observed sessions

- Entry point: `autoRegisterSession` in [`desktop/src/main/session/tree-manager/auto-register.ts`](../src/main/session/tree-manager/auto-register.ts) (`auto-register.ts:170-180`) — calls `listSkillsAndInstructions().filter(e => e.enabled)`, builds the message with `buildStartupContextMessage`, and fires `injectOpenCodeMessage` directly.
- Reached from:
  - `session.created.1` SSE events — [`sse-subscription.ts`](../src/main/session/tree-manager/sse-subscription.ts) (`sse-subscription.ts:128-131`).
  - `hydrateTaskSubagentSession` — `sse-subscription.ts:86`.
  - REST seeding on startup — [`rest-seed.ts`](../src/main/session/tree-manager/rest-seed.ts) (`rest-seed.ts:52`).
- Purpose: child/subagent sessions observed only through SSE (never through an explicit `register_connection` MCP call) still receive DB skills/instructions so they have the same knowledge context as the parent.
- **This path participates in the shared dedupe set**: after enqueueing the injection, `auto-register.ts` calls `markDbContextInjected(info.id)` (`db-context-injection.ts`) so that a later MCP-transport bind via `maybeInjectDbContextOnConnect` (trigger b) will skip with reason `already-injected-this-process` and not re-inject the same bootstrap.
- **Delivery mode:** like the other three triggers, this path sends the bootstrap in the **user-message body** with `noReply: true`; the `systemMessage` argument is intentionally unused. This is required because, per [Wire delivery](#wire-delivery), OpenCode's per-call `system` slot only persists while the injected row is `lastUser` and would evaporate on the session's first real user prompt.

#### Previous edge case: double injection (mitigated)

The tree-manager SSE path (d) and the MCP auto-register path (b) previously maintained independent state, so the same bootstrap `<system-reminder>` could be injected **twice** when both paths covered the same session.

This is mitigated today: after path (d) enqueues its injection it calls `markDbContextInjected()` which populates the shared dedupe `Set<string>` in `db-context-injection.ts`. When the MCP transport later binds to the same session and path (b) evaluates `decideShouldInjectDbContext`, the decision returns `already-injected-this-process` and path (b) is a no-op.

Paths (a) (`register_connection`) and (c) (post-CRUD reminder) are unaffected — they have different semantics and do not consult this dedupe set.

---

## Message shape

The startup-context XML is produced by `buildStartupContextMessage` in [`startup-context.ts`](../src/main/tools/startup-context.ts) (`startup-context.ts:33`).

**Structure:**

1. A top-level `<system-reminder>` wrapper.
2. **Bootstrap header** with:
   - `Registered agent` (channel name)
   - `Project` (project name)
   - `Base directory` (or `not provided`)
   - `OpenCode session ID` + a reminder to pass it as `openCodeSessionId` on every tool call (only when the ID is known)
   - Prompting policy (use interactive prompt tools)
   - Timeout policy (re-prompt on timeout, including `-32001`)
   - Stop phrases (exact match list)
   - Parallel-subagents naming tip
3. **`<available_skills source="db">`** block — one `<skill>` per enabled `type='skill'` row, containing `<name>`, `<description>`, and a literal `<source>db</source>` marker. **Full content is NOT inlined** — agents fetch it on demand.
4. **`<instructions source="db">`** block — one `<instruction>` per enabled `type='instruction'` row, containing `<name>`, `<description>`, and a `<content>…</content>` block with the full Markdown body inlined verbatim. These are always-active policies.
5. **Trailing hint** (only emitted when skills are present): instructs the agent to call `manage_skills_and_instructions` with `action: "get"` to retrieve a skill's full content by name.
6. Closing `</system-reminder>`.

**Empty blocks are never emitted.** If there are no enabled skills, the `<available_skills>` block and the trailing hint are both omitted. The same rule applies to `<instructions>`.

The `source="db"` / `<source>db</source>` markers let agents distinguish DB-stored entries from OpenCode's own file-based skill injections (which use `<location>file://…</location>`).

### Annotated example

```xml
<system-reminder>
Interactive MCP Desktop session bootstrap:
- Registered agent: Fix authentication bug
- Project: my-project
- Base directory: /Users/me/projects/my-project
- OpenCode session ID: ses_abc123
- Pass this as openCodeSessionId when calling any interactive-desktop MCP tool.
- Prompting policy: use interactive prompt tools for user questions.
- Timeout policy: if a prompt times out or returns a timeout error (including -32001), re-prompt immediately.
- Stop phrases (exact match): "Stop prompting", "End session", "Don't ask anymore", "Close conversation".
- Parallel subagents should use unique agent names to avoid sidebar name collisions.

<available_skills source="db">
  <skill>
    <name>code-review</name>
    <description>Step-by-step code review workflow</description>
    <source>db</source>
  </skill>
</available_skills>

<instructions source="db">
  <instruction>
    <name>typescript-rules</name>
    <description>TypeScript coding standards</description>
    <content>
# TypeScript Rules

- No `any` types
- Prefer interfaces over type aliases for public API
    </content>
  </instruction>
</instructions>

Use the manage_skills_and_instructions tool with action "get" to retrieve the full content of any skill by name.
</system-reminder>
```

---

## Wire delivery

Delivery is performed by `injectOpenCodeMessage` in [`desktop/src/main/opencode/injector.ts`](../src/main/opencode/injector.ts) (`injector.ts:63`).

**Signature (relevant args):**

```ts
injectOpenCodeMessage(
  openCodeSessionId: string,
  message: string,             // the <system-reminder> block goes here
  attachments: Attachment[] | undefined,
  openCodePort: number,
  mcpServerPort?: number,
  noReply = true,              // true — do NOT trigger an agent reply turn
  modelOverride?: ModelOverride,
  systemMessage?: string,      // intentionally unused for DB-context injection
  agent?: string,
): Promise<{ ok: boolean; error?: string; noReply?: boolean }>
```

The startup-context message is sent as the `message` argument — i.e. as the text of a **user message part** with `noReply: true` — not via OpenCode's per-call `system` slot.

### Why message parts, not the `system` field

Per OpenCode's `opencode/packages/opencode/src/session/llm.ts`, the per-call `system` value is appended to the system prompt only while the injected message is the **`lastUser`** message. As soon as the user sends another real message, the injected row is no longer `lastUser`, the extra `system` content is dropped, and the reminder disappears from the model's view.

By storing the reminder as the body of a `noReply` user message, it is persisted as a normal row in `messages[]`. OpenCode then replays it on every subsequent step via `MessageV2.toModelMessages` (`opencode/packages/opencode/src/session/message-v2.ts`), which is exactly what we want for always-active skills/instructions context.

`noReply: true` prevents OpenCode from generating an agent turn in response to the injection — the reminder is a context drop, not a conversational input.

See `register-connection-background.ts:186-205` for the inline rationale in code.

---

## De-duplication

### Per-process dedupe set

[`db-context-injection.ts`](../src/main/tools/db-context-injection.ts) keeps an in-memory `Set<string>` named `injectedSessionIds` (`db-context-injection.ts:45`). Every time `maybeInjectDbContextOnConnect` decides to inject, it adds the session ID to the set before firing the background task (`db-context-injection.ts:131`).

- **Scope:** one desktop-app process lifetime.
- **Reset:** cleared on app restart. This is intentional — after a restart the agent's awareness of any previously injected reminder is also gone (OpenCode may or may not re-replay the old messages depending on resume state), so re-injecting on the next connect is the correct behavior.
- **Test hooks:** `_resetInjectedSessionsForTests` and `_getInjectedSessionsForTests` are exported for unit tests only.

Note: the dedupe set gates both the **MCP auto-register** path (trigger b) and the **SSE tree-manager** path (trigger d) — the latter calls `markDbContextInjected()` after enqueueing its own injection so path (b) will skip on a later MCP-transport bind. Explicit `register_connection` calls (trigger a) and post-CRUD change reminders (trigger c) are not gated by this set — they have different semantics.

### Pure decision helper

`decideShouldInjectDbContext` (`db-context-injection.ts:62`) is a pure function that returns a `MaybeInjectDecision` with a `reason` for logging/debugging. It is exported for unit testing.

**Reasons:**

| Reason                          | When                                                             |
| ------------------------------- | ---------------------------------------------------------------- |
| `no-session-id`                 | `openCodeSessionId` is null / undefined.                         |
| `already-injected-this-process` | The session ID is in `injectedSessionIds` for this process.      |
| `no-enabled-entries`            | `listSkillsAndInstructions()` returned zero `enabled=true` rows. |
| `inject`                        | None of the above — proceed to build and inject the message.     |

---

## Post-CRUD diff reminder

When `manage_skills_and_instructions` performs a `register`, `update` (upsert over an existing name), or `delete`, the tool calls `broadcastSkillsChanged` (`manage-skills-and-instructions.ts:30`). It:

1. Enumerates active OpenCode connections via `getRegisteredConnectionsByProvider('opencode')`.
2. Filters them through `pickReminderTargets` (see [`skills-broadcast.ts`](../src/main/tools/skills-broadcast.ts)).
3. Builds a small `<system-reminder>` via `buildSkillsChangedReminder` (`startup-context.ts:131`).
4. Fires one `injectOpenCodeMessage(..., noReply: true)` per target. Errors are logged but never thrown — UI mutations must not block on injection failures.

**The reminder does NOT re-inject the full block.** It contains only:

- A single-sentence notice: `A DB-stored {type} was {action}: {name}.`
- A pointer to `manage_skills_and_instructions` `action: "list"` for the fresh list.
- For **skills**: a pointer to `action: "get"` for fetching updated content on demand.
- For **instructions**: a note that the updated content will be re-injected on the next session bootstrap.

This keeps the post-CRUD traffic small and pushes full-content retrieval to on-demand reads.

### Asymmetry: MCP tool vs. IPC handlers (resolved)

Historically, the post-CRUD broadcast fired **only when mutations went through the MCP tool handler**. Renderer-side IPC handlers in [`desktop/src/main/ipc/handlers/skills-handlers.ts`](../src/main/ipc/handlers/skills-handlers.ts) did not call `broadcastSkillsChanged`, so edits from the Settings UI were invisible to running agents until the next session bootstrap.

**This is no longer the case.** The following IPC handlers now also call `broadcastSkillsChanged` (or `broadcastSessionScopeChanged` where applicable) in addition to emitting the renderer-facing `skills-updated` event:

| IPC channel                           | Broadcast                                                                                                                               |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `upsert-skill-or-instruction`         | `broadcastSkillsChanged('registered'                                                                                                    | 'updated', …)` based on pre-fetch existence. |
| `delete-skill-or-instruction`         | `broadcastSkillsChanged('deleted', …)` — pre-fetches for type/name.                                                                     |
| `toggle-skill-or-instruction-enabled` | `broadcastSkillsChanged('updated', …)` when a row flips.                                                                                |
| `set-entry-scope`                     | `broadcastSkillsChanged('updated', …)` — re-fetches to recover type/name.                                                               |
| `set-session-scoped-entries`          | `broadcastSessionScopeChanged(providerType, providerSessionId, {added, removed})` — targeted at a single session, not broadcast to all. |

As a result, edits from the Settings UI are now delivered to running agents in real time, with the same `<system-reminder>` shape used by MCP-tool-initiated mutations.

---

## Enabled flag semantics

Only rows with `enabled = true` are injected. This is enforced in two places:

- `buildStartupContextMessage` filters `entries.filter((e) => e.enabled)` before bucketing by type (`startup-context.ts:71`).
- `maybeInjectDbContextOnConnect` pre-filters to enabled rows and uses that count for the `no-enabled-entries` decision (`db-context-injection.ts:109`).

Toggling is performed by `toggleSkillOrInstructionEnabled` in the database layer; it flips the `enabled` column without altering content. A disabled entry remains in the DB and is invisible to agents until re-enabled — at which point the next injection trigger (e.g. the change broadcast, or the next auto-register after app restart) will surface it.

- **Enable/disable is broadcast to live agents** via the `toggle-skill-or-instruction-enabled` IPC handler, which calls `broadcastSkillsChanged('updated', …)` after flipping the column. Running agents receive the change reminder immediately; the new enabled-set takes effect on the next injection trigger.

---

## Folders & per-session scoping

As of schema version 12, every `skills_and_instructions` row carries two additional columns that affect injection:

| Column      | Values                           | Role                                                                             |
| ----------- | -------------------------------- | -------------------------------------------------------------------------------- |
| `folder_id` | `integer \| null`                | Purely organisational. Ignored by the injection pipeline.                        |
| `scope`     | `'global'` \| `'session-scoped'` | Gates whether the row is injected unconditionally or only for opted-in sessions. |

A sibling table `session_scoped_entries(provider_type, provider_session_id, entry_name)` records per-session opt-ins for `session-scoped` entries. The composite primary key `(provider_type, provider_session_id)` matches the session identity used throughout the app.

### Scope semantics

- **`scope = 'global'`** — injected on every trigger (a)/(b)/(c)/(d) for every session (the pre-existing default).
- **`scope = 'session-scoped'`** — injected **only** when a row exists in `session_scoped_entries` linking the entry's `name` to the target session's `(providerType, providerSessionId)`. Otherwise the entry is omitted from both `<available_skills>` and `<instructions>` blocks for that session.

Scope filtering is applied by `buildStartupContextMessage` in [`startup-context.ts`](../src/main/tools/startup-context.ts) via the `sessionOptIns: Set<string>` argument: an entry is included iff `scope === 'global' || sessionOptIns.has(entry.name)`. Callers resolve the opt-in set by reading `listSessionScopedEntryNames(providerType, providerSessionId)` before building the message. Triggers (a), (b), and (d) each do this lookup before constructing their bootstrap.

Folders (`folder_id`) do not affect injection — they exist solely to help the user organise large lists in the Settings UI. Deleting a folder nullifies `folder_id` on its orphaned entries (their scope is untouched).

### Per-session opt-in broadcast

When the set of opted-in entries for a session changes (via the `set-session-scoped-entries` IPC, backed by the inline composer's "Scoped skills" panel — see [`SessionScopedSkillsPanel.tsx`](../src/renderer/src/components/prompt/SessionScopedSkillsPanel.tsx)), the desktop app sends a **targeted** reminder to exactly that session via `broadcastSessionScopeChanged` in [`skills-broadcast.ts`](../src/main/tools/skills-broadcast.ts).

The reminder is built by `buildSessionScopeChangedReminder` in [`startup-context.ts`](../src/main/tools/startup-context.ts) and lists the `{name, type}` of entries that were **added** and **removed** from the session's opt-in set since the last mutation. Like all other injection triggers, it is delivered as the body of a `noReply: true` user-message part so OpenCode replays it on every subsequent step. If the diff is empty, no injection is fired.

This keeps each session's live context in sync with the user's session-scope toggles without re-inflating the full bootstrap.

---

## See also

- [`DATABASE.md`](./DATABASE.md) — schema for `skills_and_instructions`.
- [`TOOLS.md`](./TOOLS.md#manage_skills_and_instructions) — MCP API for `manage_skills_and_instructions`.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — position of `manage-skills-and-instructions.ts` in the main-process tools layer.
- [`MCP-SERVER.md`](./MCP-SERVER.md) — auto-register flow that triggers `maybeInjectDbContextOnConnect`.
