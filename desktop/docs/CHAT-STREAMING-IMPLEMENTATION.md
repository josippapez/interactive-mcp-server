# Chat Streaming Implementation

## Current implementation

The desktop renderer now uses a minimal TanStack-based streaming path for live
conversation updates.

### TanStack Pacer

- Package added: `@tanstack/pacer`
- Used in: `desktop/src/renderer/src/hooks/delta-batcher-scheduler.ts`
- Current role:
  - replaces the old handwritten `setTimeout` flush scheduler
  - provides paced leading and trailing flushes for streamed deltas/parts

### TanStack Store

- Package added: `@tanstack/store`
- Used in: `desktop/src/renderer/src/store/conversation-stream-store.ts`
- Current role:
  - owns the narrow live-stream buffer only
  - tracks:
    - text delta buffer
    - pending full parts
    - stale delta suppression keys

### Current composition

- `delta-batcher.ts` keeps the public batcher API unchanged
- `delta-batcher-core.ts` contains pure merge/apply helpers
- `delta-batcher-scheduler.ts` owns pacing behavior
- `conversation-stream-store.ts` owns temporary streaming state

This is intentionally a minimal integration. The broader chat/session state is
still owned by existing renderer hooks and state containers.

## What is working now

- streamed deltas still merge into live messages
- full parts still supersede stale deltas
- first streamed updates render immediately, with a paced follow-up flush while
  streaming remains hot
- `flush()` and `dispose()` semantics are preserved
- renderer build passes after the TanStack integration

## What is still left to do

### 1. More aggressive pacing parity with OpenCode

The current integration improved scheduling structure, but not full TUI parity.
Remaining work:

- reduce or suppress non-terminal reconcile fetches during active streaming
- test faster pacing and/or leading-first flush behavior
- move more pacing pressure to visible text rendering instead of upstream state

Likely files:

- `desktop/src/renderer/src/hooks/useConversation.ts`
- `desktop/src/renderer/src/hooks/delta-batcher-scheduler.ts`
- `desktop/src/renderer/src/components/MorphdomMarkdown.tsx`
- `desktop/src/renderer/src/components/prompt/MessageItem.tsx`

### 2. Broader Store-based ownership refactor

Current Store usage is only for the temporary stream buffer. A broader refactor
is still open if we want materially lower renderer churn.

Recommended next scope:

- move prompt/chat/session graph ownership into TanStack Store
- derive merged chat timeline from selectors instead of render-time merging
- keep Jotai for low-frequency settings/config domains for now

Likely files:

- `desktop/src/renderer/src/store/session-chat-store.ts` (new)
- `desktop/src/renderer/src/store/session-chat-selectors.ts` (new)
- `desktop/src/renderer/src/store/conversation-store.ts` (new)
- `desktop/src/renderer/src/hooks/useConnections/useConnections.ts`
- `desktop/src/renderer/src/hooks/useConversation.ts`
- `desktop/src/renderer/src/components/prompt/ChatHistoryView.tsx`

### 3. Spawn/session visibility parity

Recent work improved first visibility, but more parity work remains:

- optimistic child-session insertion is now present
- corrective refresh is no longer gating first visibility
- reconnect/restore still needs continued live validation against OpenCode TUI

### 4. Context usage parity

Recent fixes now:

- replay pending startup session-tree snapshots after the window exists
- recompute context usage from fresh OpenCode session token reads instead of
  freezing on the first cached value
- periodically refresh context usage while the session is active

Further parity work may still be needed if OpenCode derives usage from more
event sources than the desktop currently mirrors.

## Related files

- `desktop/src/renderer/src/hooks/delta-batcher.ts`
- `desktop/src/renderer/src/hooks/delta-batcher-core.ts`
- `desktop/src/renderer/src/hooks/delta-batcher-scheduler.ts`
- `desktop/src/renderer/src/store/conversation-stream-store.ts`
- `desktop/src/renderer/src/hooks/useConversation.ts`
- `desktop/src/renderer/src/hooks/useContextUsage.ts`
- `desktop/src/main/ipc/handlers.ts`
- `desktop/src/main/session/tree-manager.ts`
- `desktop/src/main/tools/register-connection-background.ts`
