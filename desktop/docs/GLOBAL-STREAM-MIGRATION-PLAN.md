# Global Stream Migration Plan

## Goal

Move the desktop app from the current split event model to a global-stream-driven architecture that is closer to OpenCode's runtime model, while preserving existing UI behavior and avoiding a high-risk rewrite.

## Why This Exists

The current desktop app mixes two different data delivery paths:

1. Main-process global SSE for session discovery and session-tree updates.
2. Session-scoped IPC plus REST reconciliation for live conversation content.

That split works, but it increases complexity in the renderer and makes event timing harder to reason about. During the prompt/chat UI cleanup, the delayed appearance of some tool output traced back to renderer-side pacing and batching behavior in the conversation pipeline. OpenCode's architecture is simpler in this area: it consumes a single global event stream and reduces those events into shared stores.

This document defines a staged migration path toward that model.

## Current State

### Main process

- Subscribes to OpenCode `/global/event` (a unified SSE stream carrying both in-process `Bus` events and versioned sync events) for session lifecycle updates.
- Maintains an in-memory session tree cache.
- Emits `session-tree-updated` snapshots to the renderer.
- Still relies on session-scoped IPC and REST fetches for message history and live conversation content.

### Renderer

- Maintains conversation state through `useConnections` and related hooks.
- Merges a mix of:
  - full session-tree snapshots
  - IPC conversation events
  - REST-loaded history
  - locally staged optimistic state
- Uses pacing/batching logic for streaming parts, with special handling now added so non-text parts flush immediately.

### Observed drawbacks

- Two mental models for one UI: global session state and session-local conversation state.
- Renderer state is harder to debug because ordering depends on snapshots, IPC timing, local staging, and fetch reconciliation.
- New event types require plumbing through multiple paths.
- Tool cards and non-text parts are more likely to feel delayed when they share batching paths designed for text streaming.

## Reference Model From OpenCode

OpenCode is closer to a single-event-log model:

- A global event stream is subscribed once.
- Events such as `session.status`, `message.updated`, `message.part.updated`, and `message.part.delta` are reduced into shared stores.
- UI timelines render from those stores instead of mixing multiple transport-specific flows.

We do not need to copy OpenCode exactly, but we should move toward the same core property:

**One authoritative event pipeline for live state, with reducers/store updates downstream.**

## Target Architecture

### Core idea

Introduce a global conversation event stream in the main process, then expose it to the renderer as a single ordered feed. The renderer should reduce that feed into normalized stores for:

- sessions
- messages
- message parts
- status updates
- permissions
- todos

### Desired properties

- One live event subscription path for session and conversation updates.
- Explicit event ordering and versioning.
- Normalized renderer state keyed by session/message/part IDs.
- Minimal special-case reconciliation logic.
- Text deltas can stay paced, but non-text structural updates should render immediately.
- REST should become a history/bootstrap mechanism, not a competing live-state transport.

## Non-Goals

- Rewriting the prompt UI during this migration.
- Replacing SQLite persistence.
- Removing all IPC immediately.
- Matching OpenCode internals line-for-line.

## Migration Principles

1. Keep the current UI working at every phase.
2. Introduce the new stream beside the old path first.
3. Migrate reducers and state shape before deleting old transport code.
4. Prefer adapter layers over a single large refactor.
5. Preserve existing session routing guarantees based on `openCodeSessionId`.

## Proposed Event Model

Define a desktop-owned event envelope for all live updates:

```ts
type DesktopGlobalEvent = {
  id: string;
  ts: number;
  sessionId?: string;
  kind:
    | 'session.created'
    | 'session.updated'
    | 'session.deleted'
    | 'session.status.updated'
    | 'message.upserted'
    | 'message.deleted'
    | 'message.part.upserted'
    | 'message.part.delta'
    | 'permission.updated'
    | 'todo.updated';
  payload: unknown;
};
```

Notes:

- The desktop app should own this envelope even if upstream OpenCode event names differ.
- Upstream events can be adapted in the main process.
- Existing local IPC events can also be adapted into this envelope during transition.

## Phased Plan

## Phase 0: Document and Instrument

Purpose: make the current system measurable before changing architecture.

Work:

- Document the current event flow and reducer responsibilities.
- Add lightweight debug logging around:
  - message event receive time
  - part event receive time
  - renderer apply time
  - first visible render time for tool/non-text parts
- Identify all current sources of truth for messages and message parts.

Exit criteria:

- We can explain where each live conversation update enters the system.
- We can measure end-to-end latency for text parts and tool parts.

## Phase 1: Introduce a Main-Process Global Event Adapter

Purpose: create one canonical event feed without changing the UI yet.

Work:

- Add a main-process event adapter that converts:
  - OpenCode global sync events
  - existing conversation IPC/session events
  - local desktop-only events
    into `DesktopGlobalEvent` objects.
- Emit those events over a single renderer subscription channel.
- Keep all existing renderer paths active.

Exit criteria:

- The renderer can observe one ordered global event feed.
- Existing behavior is unchanged.

## Phase 2: Normalize Renderer State

Purpose: make state updates reducer-driven instead of transport-driven.

Work:

- Introduce normalized stores or reducers for:
  - sessions by ID
  - messages by ID
  - parts by ID
  - per-session ordered message timelines
- Reduce `DesktopGlobalEvent` into those stores.
- Keep existing UI components reading through selectors/adapters so presentation stays stable.

Exit criteria:

- Live state can be reconstructed from the normalized event-reduced stores.
- UI components do not depend directly on mixed IPC payload shapes.

## Phase 3: Migrate Conversation Rendering to the Global Feed

Purpose: make live conversation updates come from the new pipeline.

Work:

- Route `message.updated`, `message.part.upserted`, and `message.part.delta` through the new reducers.
- Limit pacing to text/reasoning deltas only.
- Render structural/non-text parts immediately.
- Keep REST history loading only for initial hydration or gap recovery.

Exit criteria:

- Tool cards and other non-text parts no longer depend on the legacy live conversation path.
- The renderer uses one live source for conversation updates.

## Phase 4: Remove Legacy Live-State Paths

Purpose: simplify maintenance and reduce event duplication.

Work:

- Remove redundant session-scoped live conversation listeners.
- Delete duplicate reconcile code that is only needed because of split transports.
- Keep only:
  - bootstrap/history fetches
  - explicit recovery flows
  - the global live event subscription

Exit criteria:

- No duplicated live message application paths remain.
- Event ownership is obvious from the codebase.

## Phase 5: Hardening and Parity Validation

Purpose: make sure the new architecture behaves at least as well as the old one.

Work:

- Verify parent/subagent routing still respects `openCodeSessionId`.
- Test prompt flows, status badges, todos, permissions, and tool rendering under concurrent sessions.
- Add regression coverage for event ordering and duplicate suppression.
- Compare behavior against OpenCode for:
  - tool-card appearance latency
  - text streaming continuity
  - subagent message attribution

Exit criteria:

- No known regressions in multi-agent routing.
- Live tool rendering feels immediate.
- The global stream is the default production path.

## Data Ownership After Migration

### Main process owns

- upstream event subscriptions
- event adaptation
- persistence/bootstrap APIs
- routing identity (`providerType`, `openCodeSessionId`, `connectionId`)

### Renderer owns

- normalized view state
- event reduction
- selectors for timelines and sidebars
- presentational pacing for text deltas only

## Risks

### Event duplication

For a while, the same logical update may arrive through both old and new paths.

Mitigation:

- add stable event IDs where possible
- dedupe by message/part identity plus timestamp/version
- cut over feature-by-feature, not all at once

### Ordering bugs

Part updates may arrive before the parent message exists in reducer state.

Mitigation:

- support upsert semantics
- allow orphan-part buffering keyed by message ID
- add reducer tests for out-of-order delivery

### Renderer complexity during transition

The temporary state can be more complex than either the old or new design.

Mitigation:

- keep transition adapters isolated
- set a short removal target for legacy listeners once parity is reached

### Multi-agent regressions

Routing mistakes are costly because parent and child sessions can share a connection.

Mitigation:

- continue keying session ownership by `openCodeSessionId`
- add explicit multi-session regression tests before removing the legacy path

## Validation Plan

### Automated

- reducer tests for event ordering and deduplication
- renderer tests for timeline assembly from normalized state
- regression tests for immediate non-text part rendering
- multi-agent routing tests covering parent plus subagent concurrency

### Manual

- main agent plus subagent prompt loop
- rapid tool-call bursts
- long streaming text response followed by tool output
- reconnect/reload scenarios while a session is active

### Observability

- log event receive-to-render latency in development builds
- add a temporary debug panel or console grouping for event flow tracing

## Recommended Implementation Order

1. Build the `DesktopGlobalEvent` adapter in main.
2. Add a renderer subscription and debug-only event inspector.
3. Introduce normalized message/part reducers behind selectors.
4. Migrate non-text part rendering first.
5. Migrate text delta rendering second.
6. Remove redundant live conversation listeners.

This order targets the pain point we already observed: non-text tool rendering latency.

## Success Criteria

The migration is successful when:

- one global live feed drives session and conversation updates
- REST is only used for bootstrap/recovery, not as a competing live source
- non-text parts appear immediately when events arrive
- renderer state is easier to trace and test
- multi-agent routing remains correct

## Related Docs

- `desktop/docs/ARCHITECTURE.md`
- `desktop/docs/SESSION-ID-ROUTING-REFACTOR.md`
- `desktop/docs/CHAT-STREAMING-IMPLEMENTATION.md`
