# Renderer — Interactive MCP Desktop

The renderer is a React 19 single-page application bootstrapped with Vite and served inside the Electron `BrowserWindow`. Its source root is `desktop/src/renderer/src/`.

---

## Table of Contents

1. [App Structure Overview](#1-app-structure-overview)
2. [Component Tree](#2-component-tree)
3. [Entry Point](#3-entry-point)
4. [Theme System](#4-theme-system)
5. [Hooks Reference](#5-hooks-reference)
   - [useConnections](#51-useconnections)
   - [useIpcListeners](#52-useipclisteners)
   - [useOpenCodeInjection](#53-useopenCodeinjection)
   - [useAttachments](#54-useattachments)
   - [useAutocomplete](#55-useautocomplete)
   - [useChannelHistory](#56-usechannelhistory)
   - [useGlobalShortcuts](#57-useglobalshortcuts)
   - [useTheme](#58-usetheme)
   - [useSessionStatus](#59-usesessionstatus)
6. [Components](#6-components)
   - [App](#61-app)
   - [PromptView](#62-promptview)
   - [ChannelSidebar](#63-channelsidebar)
   - [ChannelHeader](#64-channelheader)
   - [ChannelComposer](#65-channelcomposer)
   - [ChatHistoryView](#66-chathistoryview)
   - [PromptMessage](#67-promptmessage)
   - [SessionChannelBar (AgentStatusBar)](#68-agentstatusbar)
   - [AutocompleteDropdown](#69-autocompletedropdown)
   - [AttachmentPreview](#610-attachmentpreview)
   - [QuickSwitcher](#611-quickswitcher)
   - [SettingsView](#612-settingsview)
   - [SkillsView](#613-skillsview)
   - [StatusBar](#614-statusbar)
   - [MarkdownContent](#615-markdowncontent)
   - [CollapsibleSection](#616-collapsiblesection)
   - [ShortcutHelpModal](#617-shortcuthelpmodal)
7. [Type Definitions](#7-type-definitions)
8. [Data Flow: Prompt Lifecycle](#8-data-flow-prompt-lifecycle)
9. [Session Tree Merge Logic](#9-session-tree-merge-logic)

---

## 1. App Structure Overview

The renderer is a tab-based UI with three views: **Prompts**, **Skills**, and **Settings**. All session/channel state lives in the `useConnections` hook and is threaded downward as props. The Prompts tab is always mounted (hidden with CSS when inactive) to avoid tearing live IPC state; the Skills and Settings tabs are conditionally rendered.

Sidebar selection is keyed by `openCodeSessionId ?? connectionId`. That renderer key is not always the same as the persisted session identifier used by destructive actions. Clear/remove/dismiss actions must resolve back to `sessionChannel.sessionId` (or `connectionId`) before calling main-process APIs.

Theme preference is stored in `localStorage` and applied globally to `document.documentElement` via a `data-theme` attribute. All color tokens are CSS custom properties resolved at runtime against the current theme.

Global keyboard shortcuts are managed by `useGlobalShortcuts`, which registers a single `keydown` listener on `document` and delegates to stable refs to avoid stale closures.

The app supports **Compact Mode** (stored in settings and loaded on mount) which reduces spacing and font sizes throughout the UI when enabled.

---

## 2. Component Tree

```
React.StrictMode
└── ThemeProvider                          (ThemeContext.tsx)
    └── App                                (App.tsx)
        ├── <header> titlebar
        │   └── TabButton × 3             (inline in App.tsx)
        ├── <main>
        │   ├── PromptView                 (always mounted, visibility via CSS)
        │   │   ├── ChannelSidebar         (components/prompt/ChannelSidebar.tsx)
        │   │   │   ├── Provider filter tabs (All, OpenCode, Copilot, Claude, Other)
        │   │   │   ├── Show/hide inactive toggle
        │   │   │   ├── Sessions section (tree-sorted by activity)
        │   │   │   │   └── ChannelItem × n (with status badges, unread counts)
        │   │   │   └── Direct Connections section
        │   │   ├── ChannelHeader
        │   │   ├── [intensive-chat banner] (inline JSX, when activeSession)
        │   │   ├── PromptMessage          (when prompt && !activeSession — thin banner only)
        │   │   ├── ChatHistoryView        (when !idle)
        │   │   │   ├── MarkdownContent ×n (with timestamps, unread markers)
        │   │   │   └── [predefined option buttons] (inline under active question)
        │   │   ├── [awaiting reconnection state] (inline JSX)
        │   │   ├── [idle state]           (inline JSX)
        │   │   ├── AgentStatusBar         (when sessionChannel present)
        │   │   └── ChannelComposer
        │   │       ├── AutocompleteDropdown (when suggestions active)
        │   │       └── AttachmentPreview    (when attachments present)
        │   ├── SkillsView                 (conditional — tab === 'skills')
        │   │   ├── Sidebar with tabs (All, Skills, Instructions)
        │   │   ├── Category filter dropdown
        │   │   ├── Search input
        │   │   ├── SidebarItem × n (with enable/disable toggles)
        │   │   └── Detail pane (view/edit/create modes)
        │   └── SettingsView               (conditional — tab === 'settings')
        ├── StatusBar                      (always visible)
        ├── ShortcutHelpModal              (overlaid when showShortcuts === true)
        └── QuickSwitcher                  (overlaid when showQuickSwitcher === true)
```

---

## 3. Entry Point

**File:** `main.tsx`

```tsx
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
```

Mounts the root into `#root`, wrapping the application in `React.StrictMode` and the `ThemeProvider` context.

---

## 4. Theme System

**File:** `ThemeContext.tsx`

The theme system provides a single `'dark' | 'light'` toggle that is persisted across sessions.

### Persistence

- On mount, `ThemeProvider` reads `localStorage.getItem('imcp-theme')`. Any value other than `'light'` defaults to `'dark'`.
- On every theme change, the value is written back to `localStorage` and `document.documentElement.setAttribute('data-theme', theme)` is called synchronously via `useEffect`.

### Application

CSS custom properties (e.g. `--color-bg`, `--color-agent`, `--color-text-muted`) are defined in the global stylesheet scoped to `[data-theme="dark"]` and `[data-theme="light"]` selectors. All components reference these tokens directly in Tailwind `var(...)` expressions.

### API

| Export          | Type                                         | Description                                                     |
| --------------- | -------------------------------------------- | --------------------------------------------------------------- |
| `ThemeProvider` | `React.FC<{ children }>`                     | Context provider. Must wrap the entire app.                     |
| `useTheme`      | `() => { theme: Theme; toggle: () => void }` | Consumes theme context. Throws if used outside `ThemeProvider`. |
| `Theme`         | `'dark' \| 'light'`                          | Union type for valid theme values.                              |

---

## 5. Hooks Reference

### 5.1 `useConnections`

**File:** `hooks/useConnections.ts`

Central state manager for renderer session nodes. Owns the `Map<string, SessionNode>` and all IPC event subscriptions. Called once at the `App` level.

#### Parameters

| Parameter             | Type         | Description                                                                                                     |
| --------------------- | ------------ | --------------------------------------------------------------------------------------------------------------- |
| `onActivatePromptTab` | `() => void` | Callback invoked when an inbound event requires switching to the Prompts tab (e.g. new prompt, new connection). |

#### Returned values

| Value                        | Type                                                                       | Description                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connections`                | `Map<string, SessionNode>`                                                 | All known sidebar nodes, keyed by `openCodeSessionId ?? connectionId`.                                                                                                                                                                                                                                                                                                                |
| `activeConnectionId`         | `string \| null`                                                           | ID of the currently selected sidebar node. This is a renderer node key, not always the persisted session ID.                                                                                                                                                                                                                                                                          |
| `setActiveConnectionId`      | `Dispatch<SetStateAction<string \| null>>`                                 | Setter for the active connection.                                                                                                                                                                                                                                                                                                                                                     |
| `activeConn`                 | `SessionNode \| null`                                                      | Derived: `connections.get(activeConnectionId)` or `null`.                                                                                                                                                                                                                                                                                                                             |
| `clientInfo`                 | `{ model?: string; mode?: string } \| undefined`                           | Most recently received client info from a prompt request.                                                                                                                                                                                                                                                                                                                             |
| `handleSubmit`               | `(answer: string, attachments?: Attachment[]) => void`                     | Submits an answer for the active connection's pending prompt. Before sending the response, fires a fire-and-forget `window.api.injectDocContext?.(connectionId, openCodeSessionId, answer, baseDirectory)` call (using `resolveInjectionSessionId`) to inject relevant repository documentation into the OpenCode session context ahead of the reply.                                 |
| `handleSelectOption`         | `(option: string) => void`                                                 | Submits a predefined option as the answer for the active prompt. Like `handleSubmit`, also fires a fire-and-forget `window.api.injectDocContext?.(...)` call before sending the response.                                                                                                                                                                                             |
| `handleDismissStatus`        | `(connectionId: string, timestamp: Date) => void`                          | Removes a `SessionStatus` entry by timestamp.                                                                                                                                                                                                                                                                                                                                         |
| `handleDismissSession`       | `(connectionId: string) => void`                                           | Calls `window.api.dismissSession` with the persisted session identifier (`connectionId`).                                                                                                                                                                                                                                                                                             |
| `handleQueueSessionMessage`  | `(sessionId: string, message: string, attachments?: Attachment[]) => void` | Queues a message for the session via `window.api.queueSessionMessage` and optimistically appends an `'outbound'` message to `channelMessages`. When an OpenCode session is active, also calls `window.api.injectOpenCodeMessage`; image attachments are saved to the persistent attachment store and referenced by `/attachments/:filename` URLs, while text attachments are inlined. |
| `handleClearChannelMessages` | `(sessionId: string) => void`                                              | Calls `window.api.clearSessionChannelMessages` to clear DB history for the session.                                                                                                                                                                                                                                                                                                   |
| `handleRemoveSession`        | `(sessionId: string) => void`                                              | Calls `window.api.removeSessionChannel` to delete the session channel entirely.                                                                                                                                                                                                                                                                                                       |
| `handleToggleDocContext`     | `(connectionId: string) => void`                                           | Toggles the `docContextEnabled` flag for a session, controlling whether doc context is injected.                                                                                                                                                                                                                                                                                      |
| `jumpToFirstPendingPrompt`   | `() => void`                                                               | Selects the first session that has a pending prompt (used when clicking the Prompts tab).                                                                                                                                                                                                                                                                                             |

#### Internal design

**Listener registration guard:** IPC listeners are registered inside a `useEffect` that runs once. The `listenersRegistered` ref prevents double-registration in `React.StrictMode`.

**Stable refs pattern:** `onActivatePromptTab` and `activeConnectionId` are mirrored to refs (`activateRef`, `activeConnectionRef`) so that event callbacks registered at mount time always access the latest values without needing to re-register.

**`withNode` helper:** All state mutations go through `withNode(nodeId, updater)`, which performs a safe `Map` clone and applies the updater only if the node exists.

#### IPC events handled

| Event                             | Effect                                                                                                                                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onSessionTreeInvalidated`        | Payload-free signal. Renderer pulls the fresh tree via `window.api.getSessionTree()` and rebuilds topology from the returned flat snapshot, preserving runtime state and loading history for newly claimed `connectionId`s. |
| `onConnectionOpened`              | Adds a direct-connection node keyed by `connectionId` when no OpenCode-backed node already owns that connection; loads channel history; activates prompt tab.                                                               |
| `onConnectionClosed`              | Removes only direct-connection nodes. OpenCode-backed nodes are governed by later session-tree snapshots or explicit deletion events.                                                                                       |
| `onPromptRequest`                 | Sets `prompt` and `hasPendingPrompt` on the connection; appends a `'question'` channel message; updates `clientInfo`; activates prompt tab.                                                                                 |
| `onIntensiveChatStart`            | Sets `activeSession` (`{ id, title }`) on the connection; activates prompt tab.                                                                                                                                             |
| `onIntensiveChatStop`             | Clears `activeSession` to `null`.                                                                                                                                                                                           |
| `onSessionStatusUpdate`           | Appends a new `SessionStatus` to `sessionStatuses`.                                                                                                                                                                         |
| `onSessionChannelDeleted`         | Removes the owning node by persisted session identifier (`connectionId`) or direct node key; clears active selection if it matched.                                                                                         |
| `onSessionChannelMessagesCleared` | Resets `channelMessages` and `unreadCount` to empty/zero.                                                                                                                                                                   |

#### Startup/session reconciliation flow

The renderer reconciles against the session tree it **pulls on demand** via `window.api.getSessionTree()` instead of consuming pushed full snapshots or maintaining a separate restored-tab model.

- On mount and on every payload-free `session-tree-invalidated` IPC event, the renderer calls `window.api.getSessionTree()`. The returned flat snapshot supplies live OpenCode sessions from pinned folders enriched with `registered_connections` metadata. See [`ARCHITECTURE.md — Pinned-folder session pagination`](./ARCHITECTURE.md#pinned-folder-session-pagination).
- `mergeSessionTreeSnapshot` rebuilds the node map using `openCodeSessionId ?? connectionId` keys while preserving runtime state such as prompts, messages, unread counts, and statuses.
- If a snapshot node claims a `connectionId` that previously existed as a direct connection, the direct node's runtime state is absorbed into the OpenCode-keyed node.
- History is loaded once per claimed `connectionId` via `getSessionChannelHistory(connectionId)`.
- Direct MCP connections with no OpenCode session remain keyed by `connectionId` and are preserved until explicitly removed or closed.

#### Unread count logic

When a message targets a node that is **not** the currently active one, `unreadCount` is incremented. It resets to `0` whenever that node becomes active.

---

### 5.2 `useIpcListeners`

**File:** `hooks/useIpcListeners.ts`

Extracted hook that registers all Electron IPC event listeners (`onConnectionOpened`, `onConnectionClosed`, `onPromptRequest`, `onIntensiveChatStart`, `onIntensiveChatStop`, `onSessionStatusUpdate`, `onSessionChannelCreated`, `onSessionChannelDeleted`, `onSessionChannelMessagesCleared`, `onAgentMessage`, `onSessionTreeInvalidated`). Called once by `useConnections`. On `onSessionTreeInvalidated`, the hook pulls the current tree via `window.api.getSessionTree()` and feeds it through `mergeSessionTreeSnapshot`.

> **React effect discipline.** The subscription effect uses **empty `[]` deps** with `optsRef.current = opts` assigned on every render, and callback wrappers dereference `optsRef.current` at call time. A previous version with an 18-callback deps array caused a 127% / 1.22 GB renderer CPU regression (re-register → initial fetch → setState → parent re-render loop). See the "React: `useEffect` Discipline" section in the root [`AGENTS.md`](../../AGENTS.md) for the full checklist.

---

### 5.3 `useOpenCodeInjection`

**File:** `hooks/useOpenCodeInjection.ts`

Extracted hook that handles the OpenCode message injection logic. When the user sends a message via the composer and an `openCodeSessionId` is present on the active connection, this hook calls `window.api.injectOpenCodeMessage` alongside the queue path. Manages error state for injection failures.

---

### 5.4 `useAttachments`

**File:** `hooks/useAttachments.ts`

Extracted hook for managing file attachments in `ChannelComposer`. Handles image paste events, file picker dialog, reading files via `window.api.readFileForAttachment`, and maintaining the attachment array state.

---

### 5.5 `useAutocomplete`

**File:** `hooks/useAutocomplete.ts`

Extracted hook for the `#` / `@` file autocomplete in `ChannelComposer`. Manages trigger detection, debounced `window.api.searchFiles` calls, suggestion list state, keyboard navigation (arrow keys, Enter, Tab, Escape), and suggestion application.

---

### 5.6 `useChannelHistory`

**File:** `hooks/useChannelHistory.ts`

Extracted hook for loading and managing channel message history. Calls `window.api.getSessionChannelHistory` when a session channel is attached and provides the `pushMessage` / `appendAnswerMessage` helpers used by `useConnections`.

---

### 5.7 `useGlobalShortcuts`

**File:** `hooks/useGlobalShortcuts.ts`

Registers a single `keydown` listener on `document` for application-wide keyboard shortcuts. Uses refs to keep `showShortcuts` and `showQuickSwitcher` state stable inside the handler.

#### Parameters

| Parameter             | Type                         | Description                                         |
| --------------------- | ---------------------------- | --------------------------------------------------- |
| `onSwitchTab`         | `(tab: 1 \| 2 \| 3) => void` | Callback to switch the active tab by 1-based index. |
| `onOpenQuickSwitcher` | `(() => void) \| undefined`  | Optional callback when quick switcher opens.        |

#### Returned values

| Value                | Type         | Description                                 |
| -------------------- | ------------ | ------------------------------------------- |
| `showShortcuts`      | `boolean`    | Whether the `ShortcutHelpModal` is visible. |
| `openShortcuts`      | `() => void` | Sets `showShortcuts` to `true`.             |
| `closeShortcuts`     | `() => void` | Sets `showShortcuts` to `false`.            |
| `showQuickSwitcher`  | `boolean`    | Whether the `QuickSwitcher` is visible.     |
| `openQuickSwitcher`  | `() => void` | Sets `showQuickSwitcher` to `true`.         |
| `closeQuickSwitcher` | `() => void` | Sets `showQuickSwitcher` to `false`.        |

#### Shortcut bindings

| Key combo       | Condition                               | Action                     |
| --------------- | --------------------------------------- | -------------------------- |
| `⌘K` / `Ctrl+K` | —                                       | Toggle Quick Switcher      |
| `⌘1` / `Ctrl+1` | —                                       | Switch to Prompts tab      |
| `⌘2` / `Ctrl+2` | —                                       | Switch to Skills tab       |
| `⌘3` / `Ctrl+3` | —                                       | Switch to Settings tab     |
| `⌘/` / `Ctrl+/` | —                                       | Toggle shortcut help modal |
| `?`             | Target is not `<textarea>` or `<input>` | Toggle shortcut help modal |
| `Escape`        | Quick Switcher open                     | Close Quick Switcher       |
| `Escape`        | Help modal open                         | Close shortcut help modal  |

---

### 5.8 `useTheme`

**File:** `ThemeContext.tsx`

```ts
function useTheme(): { theme: Theme; toggle: () => void };
```

Thin wrapper around `useContext(ThemeContext)`. Returns the current theme and a stable `toggle` callback (memoized with `useCallback`). Must be called within a component tree wrapped by `ThemeProvider`.

---

### 5.9 `useSessionStatus`

**File:** `hooks/useSessionStatus.ts`

Fetches live session status from the OpenCode server via the `/session/status` endpoint and SSE events.

#### Parameters

| Parameter | Type      | Default | Description                       |
| --------- | --------- | ------- | --------------------------------- |
| `enabled` | `boolean` | `true`  | Whether to enable status fetching |

#### Returned values

| Value       | Type                                               | Description                                  |
| ----------- | -------------------------------------------------- | -------------------------------------------- |
| `statusMap` | `Record<string, { type: SessionStatusType }>`      | Map of session IDs to their current status.  |
| `isLoading` | `boolean`                                          | True while fetching status.                  |
| `refresh`   | `() => Promise<void>`                              | Manually refresh all session statuses.       |
| `getStatus` | `(sessionId: string) => SessionStatusType \| null` | Helper to get status for a specific session. |

#### `SessionStatusType`

```ts
type SessionStatusType = 'busy' | 'idle' | 'error' | 'unknown';
```

#### Key behaviors

- Polls every 3 seconds as a fallback when SSE is unavailable.
- Listens for `session.status` SSE events for real-time updates.
- When SSE events are received, polling is automatically disabled.
- Used by `ChannelSidebar` to show live session status badges (working, idle, error).

---

## 6. Components

### 6.1 `App`

**File:** `App.tsx`

The root component. Owns tab state, compact mode, and orchestrates the top-level layout.

#### State

| State         | Type                                 | Initial    | Description                                             |
| ------------- | ------------------------------------ | ---------- | ------------------------------------------------------- |
| `activeTab`   | `'prompt' \| 'skills' \| 'settings'` | `'prompt'` | Currently visible tab.                                  |
| `compactMode` | `boolean`                            | `false`    | Whether compact mode is enabled (loaded from settings). |

#### Key behaviors

- Calls `useConnections(switchToPrompt)` where `switchToPrompt` is a stable `useCallback` that sets `activeTab` to `'prompt'`.
- Calls `useGlobalShortcuts({ onSwitchTab: switchTab })` to wire keyboard shortcuts.
- Derives `hasAnyPrompt` by scanning `connections.values()` for any entry where `hasPendingPrompt === true`.
- Shows the pulsing badge on Prompts tab only when there's a pending prompt on a channel that is NOT currently visible.
- Renders the Prompts tab wrapped in a div that uses `className="hidden"` when inactive rather than unmounting, preserving all hook and IPC state.
- `SkillsView` and `SettingsView` are lazy-loaded via `React.lazy` + `<Suspense>` and conditionally rendered (`{activeTab === 'skills' && <SkillsView />}` / `{activeTab === 'settings' && <SettingsView />}`), so they mount/unmount on tab switch. `QuickSwitcher` is similarly lazy-loaded and only rendered when `showQuickSwitcher` is true.
- Applies `data-compact="true"` attribute when compact mode is enabled.
- When clicking the Prompts tab, also calls `jumpToFirstPendingPrompt()` to auto-select a session with a pending prompt.

#### Internal: `TabButton`

A co-located internal component (not exported). Props:

| Prop       | Type                   | Description                                                       |
| ---------- | ---------------------- | ----------------------------------------------------------------- |
| `active`   | `boolean`              | Controls active styling (colored bottom border).                  |
| `onClick`  | `() => void`           | Tab switch handler.                                               |
| `children` | `React.ReactNode`      | Tab label.                                                        |
| `badge`    | `boolean \| undefined` | If true, renders an animated pulsing dot in the top-right corner. |
| `shortcut` | `string \| undefined`  | Shortcut hint rendered in a smaller span next to the label.       |

---

### 6.2 `PromptView`

**File:** `pages/PromptView.tsx`

The main prompt interaction view. Renders the two-column layout: a resizable sidebar on the left and a flexible content area on the right.

#### Props

| Prop                    | Type                                            | Description                                                                                         |
| ----------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `connections`           | `Map<string, SessionNode>`                      | All session nodes, forwarded to `ChannelSidebar`.                                                   |
| `activeConnectionId`    | `string \| null`                                | Currently selected sidebar node key.                                                                |
| `onSelectConnection`    | `(id: string) => void`                          | Sidebar selection callback.                                                                         |
| `prompt`                | `PromptData \| null`                            | Active unanswered prompt for the current connection.                                                |
| `activeSession`         | `{ id: string; title: string } \| null`         | Active intensive-chat session metadata.                                                             |
| `channelMessages`       | `ChannelMessage[]`                              | Full message history for the current connection.                                                    |
| `connectionId`          | `string \| null`                                | Persisted MCP `connectionId` for the active node; used for force-terminate and destructive actions. |
| `sessionChannel`        | `{ sessionId: string; label?: string } \| null` | Session channel metadata if one is attached.                                                        |
| `sessionStatuses`       | `SessionStatus[]`                               | Status updates for the `AgentStatusBar`.                                                            |
| `pendingPermissions`    | `PendingPermission[]`                           | Pending permission requests awaiting user decision.                                                 |
| `docContextEnabled`     | `boolean`                                       | Whether doc context injection is enabled for this session.                                          |
| `onSubmit`              | `(answer, attachments?) => void`                | Forward to `handleSubmit` from `useConnections`.                                                    |
| `onSelectOption`        | `(option) => void`                              | Forward to `handleSelectOption`.                                                                    |
| `onDismissStatus`       | `(connectionId, timestamp) => void`             | Forward to `handleDismissStatus`.                                                                   |
| `onDismissSession`      | `(connectionId) => void`                        | Forward to `handleDismissSession`.                                                                  |
| `onQueueSessionMessage` | `(sessionId, message, attachments?) => void`    | Forward to `handleQueueSessionMessage`.                                                             |
| `onClearMessages`       | `(sessionId) => void`                           | Forward to `handleClearChannelMessages`.                                                            |
| `onRemoveSession`       | `(sessionId) => void`                           | Forward to `handleRemoveSession`.                                                                   |
| `onToggleDocContext`    | `() => void`                                    | Forward to `handleToggleDocContext`.                                                                |

#### State

| State        | Type                        | Description                                                                                                   |
| ------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `chatEndRef` | `RefObject<HTMLDivElement>` | Ref attached to the bottom sentinel div. Scrolled into view on each `channelMessages` change via `useEffect`. |

#### Content area render logic (mutually exclusive states)

1. **No active connection** → "No channels yet." empty state.
2. **Active connection present**:
   - Intensive-chat banner shown when `activeSession !== null` (includes a "✕ Terminate" button that calls `window.api.forceTerminateChat`).
   - `PromptMessage` shown when `prompt && !activeSession` — renders a thin project badge + optional countdown timer (no message text).
   - `ChatHistoryView` shown when `!idle` (i.e., any of: prompt is set, activeSession is set, or `channelMessages.length > 0`). The active question message is highlighted with a colored left border and a pulsing dot; predefined option buttons appear inline below it.
   - Idle state ("Waiting for prompt from MCP client…") shown when `!prompt && !activeSession && channelMessages.length === 0` (`idle === true`).
   - `AgentStatusBar` shown when `sessionChannel !== null`.
   - `ChannelComposer` always rendered: enabled with prompt-submit behavior when `prompt` is set; enabled for session queuing when `sessionChannel` is set; otherwise disabled.

Before clear/remove/dismiss actions run, `PromptView` resolves a persisted target with `resolveSessionActionTarget({ requestedId, connectionId, sessionChannelId })`. This ensures header actions operate on the persisted session identifier rather than the selected sidebar node key.

---

### 6.3 `ChannelSidebar`

**File:** `components/prompt/ChannelSidebar.tsx`

Lists all session nodes as clickable channel buttons with advanced filtering and sorting. Wrapped in `React.memo`.

#### Props

| Prop                 | Type                       | Description                              |
| -------------------- | -------------------------- | ---------------------------------------- |
| `connections`        | `Map<string, SessionNode>` | All session nodes.                       |
| `activeConnectionId` | `string \| null`           | Currently selected sidebar node key.     |
| `onSelect`           | `(id: string) => void`     | Called when a channel button is clicked. |

#### Features

##### Provider Filter Tabs

Horizontal tab bar at the top with provider-specific filters:

| Provider | Icon | Description                   |
| -------- | ---- | ----------------------------- |
| All      | ◎    | Show all sessions             |
| OpenCode | ⬡    | OpenCode-backed sessions      |
| Copilot  | ◇    | GitHub Copilot CLI sessions   |
| Claude   | ◆    | Claude SDK sessions           |
| Other    | ○    | Standalone/direct connections |

Each tab shows the count of sessions for that provider. Tabs are only shown if there are sessions of that type.

##### Archive Toggle

Button in the Sessions header toggles between active and archived OpenCode sessions. Inactive sessions remain visible; archived visibility is controlled by the backend session-tree query.

##### Session Sorting

Sessions are sorted by activity:

1. **Running sessions first** — sessions with pending prompts, busy status, or working status
2. **Unread messages second** — sessions with unread message counts
3. **Most recent activity** — sorted by latest status/message timestamp (descending)

##### Live Session Status Badges

Each session item can show multiple status indicators (in priority order):

1. **Pending prompt** — pulsing orange dot
2. **Unread count** — numeric badge with count
3. **Busy status** — from OpenCode API, shown as pulsing amber dot
4. **Legacy status** — from `sessionStatuses` array

##### Resizable Sidebar

- Width is adjustable by dragging the right edge
- Width persisted in `localStorage` under `sidebar-width`
- Min: 200px, Max: 500px, Default: 280px

#### Internal: `ChannelItem`

Memoized component for each session row. Props:

| Prop            | Type                        | Description                    |
| --------------- | --------------------------- | ------------------------------ |
| `node`          | `SessionNode`               | Session data to display.       |
| `isActive`      | `boolean`                   | Whether this item is selected. |
| `onSelect`      | `(id: string) => void`      | Selection callback.            |
| `sessionStatus` | `SessionStatusType \| null` | Live status from OpenCode API. |

#### Internal: `ProviderBadge`

Shows provider icon with color coding:

- OpenCode: emerald
- Copilot: blue
- Claude: orange
- Standalone: gray

#### Internal: `StatusDot`

Shows status indicator from `sessionStatuses` array with color and animation:

| Type    | Color  | Animation |
| ------- | ------ | --------- |
| working | orange | pulse     |
| success | green  | none      |
| error   | red    | none      |
| info    | blue   | none      |

#### Internal: `SessionStatusBadge`

Shows live status from OpenCode API:

| Status  | Color   | Animation |
| ------- | ------- | --------- |
| busy    | amber   | pulse     |
| idle    | emerald | none      |
| error   | red     | none      |
| unknown | gray    | none      |

---

### 6.4 `ChannelHeader`

**File:** `components/prompt/ChannelHeader.tsx`

Displays the active channel label and action buttons at the top of the content area. It also owns the session-local inline find UI.

#### Props

| Prop               | Type         | Description                                              |
| ------------------ | ------------ | -------------------------------------------------------- |
| `label`            | `string`     | Channel label (session label or connection ID).          |
| `promptActive`     | `boolean`    | If true, shows a "pending prompt" badge.                 |
| `onClearMessages`  | `() => void` | Clears Q/A history and queued messages.                  |
| `onRemoveSession`  | `() => void` | Removes session channel and terminates it if active.     |
| `onDismissSession` | `() => void` | Closes the tab from the UI without removing the session. |

#### Session-local find

- The header exposes an inline find bar for the active session/channel.
- `Cmd+F` / `Ctrl+F` opens the find UI when a session is active.
- `Enter` navigates to the next match, `Shift+Enter` to the previous match, and `Escape` closes and clears the find UI.
- Search ordering is newest-first so the first active result is the latest matching message in the transcript.

#### Buttons

| Button         | Style                | Tooltip                                          |
| -------------- | -------------------- | ------------------------------------------------ |
| Clear messages | Default border       | "Clear Q/A history and unsent queued messages"   |
| Close tab      | Default border       | "Close tab from UI"                              |
| Remove session | Error-colored border | "Remove session channel and terminate if active" |

---

### 6.5 `ChannelComposer`

**File:** `components/prompt/ChannelComposer.tsx`

The text input and file attachment area at the bottom of the content pane. Handles text entry, file autocomplete, image paste, and file picker.

#### Props

| Prop            | Type                                                 | Description                                                                      |
| --------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| `enabled`       | `boolean`                                            | When `false`, the textarea is disabled and submit/paste/file-picker are blocked. |
| `baseDirectory` | `string \| undefined`                                | Root directory for file search. If absent, autocomplete is disabled.             |
| `placeholder`   | `string`                                             | Placeholder text for the textarea.                                               |
| `onSubmit`      | `(text: string, attachments?: Attachment[]) => void` | Called on send (⌘+Enter or Send button click).                                   |

#### Internal state

| State           | Type                                                    | Description                                      |
| --------------- | ------------------------------------------------------- | ------------------------------------------------ |
| `value`         | `string`                                                | Current textarea content.                        |
| `attachments`   | `Attachment[]`                                          | Pending attachments to be sent with the message. |
| `suggestions`   | `string[]`                                              | File paths returned by `window.api.searchFiles`. |
| `selectedIndex` | `number`                                                | Currently highlighted suggestion index.          |
| `target`        | `{ start: number; end: number; query: string } \| null` | Cursor span of the active `#`/`@` trigger token. |
| `loading`       | `boolean`                                               | True while awaiting `searchFiles` response.      |

#### Autocomplete

- Activated when the user types `#` or `@` anywhere on the current line (not preceded by a newline since the trigger).
- On each keypress that advances the cursor, `detectAutocomplete` scans backward from the cursor to find the nearest `#` or `@` on the current line and extracts the query substring.
- A 150 ms debounced call to `window.api.searchFiles(baseDirectory, query)` populates `suggestions`.
- `applySuggestion(filePath)` replaces the range `[target.start, target.end)` in the textarea value with the selected file path, then restores the cursor position via a `requestAnimationFrame` callback.

#### Image paste

- `handlePaste` intercepts `ClipboardEvent` items whose `type` starts with `image/`.
- Each image file is read with `FileReader.readAsDataURL`, the `base64` data portion (after the comma) is extracted, and a new `Attachment` is appended to state.

#### File picker

- `handleFilePicker` calls `window.api.openFileDialog()` to open a native file dialog.
- Each selected path is passed to `window.api.readFileForAttachment(path)`, which returns `{ data, mimeType, name, size }`.

#### Submit

- `submit` trims the value and returns early if `!enabled || (!text && attachments.length === 0)`.
- On success, calls `onSubmit`, then clears `value`, `attachments`, `target`, and `suggestions`.
- Keyboard shortcut: `⌘+Enter` (or `Ctrl+Enter`) triggers `submit`.

#### Keyboard navigation in autocomplete

| Key              | Action                             |
| ---------------- | ---------------------------------- |
| `ArrowDown`      | Move selection down (wraps to 0).  |
| `ArrowUp`        | Move selection up (wraps to last). |
| `Enter` or `Tab` | Apply selected suggestion.         |
| `Escape`         | Dismiss dropdown.                  |

---

### 6.6 `ChatHistoryView`

**File:** `components/prompt/ChatHistoryView.tsx`

Scrollable list of the unified transcript for the current connection. It merges local channel messages with provider conversation messages when available.

#### Props

| Prop                | Type                                    | Description                                                                                            |
| ------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `messages`          | `ChannelMessage[]`                      | Messages to render.                                                                                    |
| `chatEndRef`        | `RefObject<HTMLDivElement \| null>`     | Ref for the scroll-to-bottom sentinel.                                                                 |
| `activePromptId`    | `string \| null \| undefined`           | ID of the last unanswered question message. That message gets a colored left border and a pulsing dot. |
| `predefinedOptions` | `string[] \| undefined`                 | Options from the active prompt. Rendered as inline buttons directly below the active question message. |
| `onSelectOption`    | `(option: string) => void \| undefined` | Called when a predefined option button is clicked.                                                     |

#### Message rendering

| `kind`            | Role label | CSS class        |
| ----------------- | ---------- | ---------------- |
| `'question'`      | `Agent`    | `msg-agent`      |
| `'answer'`        | `You`      | `msg-user`       |
| `'outbound'`      | `Queued`   | `msg-user`       |
| `'agent_message'` | `Agent`    | `msg-agent-info` |

Each message shows:

- Role label + timestamp (`HH:MM` via `toLocaleTimeString`).
- A pulsing dot before the role label when the message is the active (unanswered) question.
- Message text rendered through `MarkdownContent`.
- Attachment name badges (📎 prefix) if `msg.attachments` is non-empty.
- Inline predefined option buttons (below the message body) when `msg.id === activePromptId` and `predefinedOptions` is non-empty.

#### Unified transcript notes

- OpenCode-backed sessions render a merged timeline of local channel events and provider conversation messages.
- Local outbound echoes are hidden once the matching provider user message arrives, preventing duplicate user entries in the transcript.
- Search highlighting and search navigation both use the same merged message ordering so the highlighted results and scroll target stay aligned.

#### Auto-scroll behavior

- The transcript follows output while the view is pinned to the bottom.
- Scrolling away pauses follow mode immediately and avoids re-snapping while the user is escaping the bottom lock.
- Switching sessions resets follow mode and scroll position cleanly for the newly selected channel.

---

### 6.7 `PromptMessage`

**File:** `components/prompt/PromptMessage.tsx`

Thin banner rendered above `ChatHistoryView` when a prompt is active but no intensive-chat session is running. Wrapped in `React.memo`.

#### Props

| Prop          | Type             | Description                                                                     |
| ------------- | ---------------- | ------------------------------------------------------------------------------- |
| `prompt`      | `PromptData`     | The prompt data to display.                                                     |
| `secondsLeft` | `number \| null` | Remaining seconds for the timeout countdown. `null` disables the timer display. |

#### Key behaviors

- Renders only when `prompt.projectName` is truthy **or** `secondsLeft !== null`. Returns `null` otherwise (no DOM output).
- If `prompt.projectName` is truthy, a styled project badge is shown.
- If `secondsLeft !== null`, a countdown timer is shown: normal style when `> 60s`, warning style at `≤ 60s`, error style at `0`.
- The prompt message text is **not** rendered here — it is displayed as a `'question'` `ChannelMessage` inside `ChatHistoryView`.

---

### 6.8 `AgentStatusBar`

**File:** `components/prompt/AgentStatusBar.tsx`

A compact bar rendered above the composer when a session channel is attached. Displays the session label and the latest status update. (Previously named `SessionChannelBar`.)

#### Props

| Prop              | Type                                              | Description                                      |
| ----------------- | ------------------------------------------------- | ------------------------------------------------ |
| `sessionChannel`  | `{ sessionId: string; label?: string }`           | Session channel metadata.                        |
| `sessionStatuses` | `SessionStatus[]`                                 | All status updates for this session.             |
| `connectionId`    | `string`                                          | Used as the first argument to `onDismissStatus`. |
| `onDismissStatus` | `(connectionId: string, timestamp: Date) => void` | Dismisses a status entry by timestamp.           |

#### Status display

Only the **last** status in `sessionStatuses` (`sessionStatuses.at(-1)`) is shown. Color and icon are selected from fixed lookup maps:

| `type`    | Color CSS var                 | Icon |
| --------- | ----------------------------- | ---- |
| `info`    | `--color-agent` (`#5599dd`)   | `ℹ`  |
| `working` | `--color-user` (`#cc7700`)    | `⚙`  |
| `success` | `--color-success` (`#22c55e`) | `✓`  |
| `error`   | `--color-error` (`#cc3333`)   | `✕`  |

A dismiss button (`×`) calls `onDismissStatus(connectionId, latestStatus.timestamp)`.

---

### 6.9 `AutocompleteDropdown`

**File:** `components/prompt/AutocompleteDropdown.tsx`

Absolutely positioned dropdown rendered above `ChannelComposer` when autocomplete is active.

#### Props

| Prop            | Type                      | Description                                                                      |
| --------------- | ------------------------- | -------------------------------------------------------------------------------- |
| `suggestions`   | `string[]`                | File paths to display.                                                           |
| `selectedIndex` | `number`                  | Index of the currently highlighted item.                                         |
| `isLoading`     | `boolean`                 | When true and `suggestions` is empty, shows "Indexing…" placeholder.             |
| `triggerChar`   | `'#' \| '@'`              | Controls the header label: `'@'` → "📎 File reference", `'#'` → "# File search". |
| `onSelect`      | `(path: string) => void`  | Called on click or Enter/Tab.                                                    |
| `onHoverIndex`  | `(index: number) => void` | Called on `mouseenter` to sync keyboard selection state.                         |

#### Key behaviors

- Uses `useEffect` on `selectedIndex` to scroll the highlighted item into view (`scrollIntoView({ block: 'nearest' })`).
- Renders at most 50 suggestions (`suggestions.slice(0, 50)`).
- Each suggestion splits the path on `/` to display the filename bold and the directory path muted.
- Uses `onMouseDown` (not `onClick`) to prevent the textarea from losing focus before selection is applied.
- Positioned with `bottom-full mb-1` so it opens upward above the composer.

---

### 6.10 `AttachmentPreview`

**File:** `components/prompt/AttachmentPreview.tsx`

Grid of attachment thumbnails shown above the textarea when the composer has pending attachments. Wrapped in `React.memo`.

#### Props

| Prop          | Type                                                 | Description                                                                                             |
| ------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `attachments` | `Attachment[]`                                       | Attachments to display.                                                                                 |
| `onRemove`    | `(index: number) => void`                            | Called when the `×` button on a thumbnail is clicked.                                                   |
| `onExpand`    | `((src: string, name: string) => void) \| undefined` | Optional callback for expanding an image. Currently passed as `() => undefined` from `ChannelComposer`. |

#### Key behaviors

- Images (`att.mimeType.startsWith('image/')`) render as 64×64 `<img>` thumbnails with `object-cover`. Clicking calls `onExpand` with the `data:` URI.
- Non-image files render as a 64×64 box with a 📄 icon and a truncated filename.
- File size is displayed at the bottom of each cell, formatted by the internal `formatFileSize` function (B / KB / MB).
- The remove `×` button is opacity-0 by default and becomes visible on `group-hover`.

---

### 6.11 `QuickSwitcher`

**File:** `components/QuickSwitcher.tsx`

Modal overlay for quick navigation and actions. Opened via `⌘K` / `Ctrl+K`. Wrapped in `React.memo`.

#### Props

| Prop                | Type                                                | Description                                     |
| ------------------- | --------------------------------------------------- | ----------------------------------------------- |
| `open`              | `boolean`                                           | Controls visibility.                            |
| `onClose`           | `() => void`                                        | Called on backdrop click or ESC.                |
| `connections`       | `Map<string, SessionNode>`                          | All session nodes for building session actions. |
| `onSelectSession`   | `(sessionId: string) => void`                       | Called when a session is selected.              |
| `onNavigate`        | `(tab: 'prompt' \| 'skills' \| 'settings') => void` | Called for tab navigation.                      |
| `onRefreshSessions` | `() => void`                                        | Called for refresh action.                      |

#### Features

##### Search

- Fuzzy search across session names, descriptions, and action labels
- Search input auto-focused when modal opens
- Results update in real-time as you type

##### Action Types

| Type         | Description                                         |
| ------------ | --------------------------------------------------- |
| `session`    | Switch to a specific session                        |
| `navigation` | Navigate to a tab (Prompts, Skills, Settings)       |
| `action`     | Run an action (Refresh, New Skill, New Instruction) |

##### Navigation Items

| ID           | Label          | Shortcut |
| ------------ | -------------- | -------- |
| nav-prompts  | Go to Prompts  | ⌘1       |
| nav-skills   | Go to Skills   | ⌘2       |
| nav-settings | Go to Settings | ⌘3       |

##### Action Items

| ID             | Label            | Description         |
| -------------- | ---------------- | ------------------- |
| action-refresh | Refresh Sessions | Reload session list |

#### Keyboard Navigation

| Key      | Action                      |
| -------- | --------------------------- |
| `↓`      | Move selection down (wraps) |
| `↑`      | Move selection up (wraps)   |
| `Enter`  | Select current item         |
| `Escape` | Close quick switcher        |

#### Key behaviors

- Sessions with pending prompts are sorted to the top
- Sessions are grouped separately from navigation and actions
- Selected item scrolls into view automatically
- Shows keyboard hints in footer

#### Exported Utilities

```ts
function buildSessionActions(
  connections: Map<string, SessionNode>,
): QuickSwitcherAction[];
function filterActions(
  actions: QuickSwitcherAction[],
  query: string,
): QuickSwitcherAction[];
function groupActions(
  actions: QuickSwitcherAction[],
): Map<QuickSwitcherAction['type'], QuickSwitcherAction[]>;
```

---

### 6.12 `SettingsView`

**File:** `pages/SettingsView.tsx`

Form for viewing and saving application settings.

#### State

| State               | Type          | Description                                                              |
| ------------------- | ------------- | ------------------------------------------------------------------------ |
| `settings`          | `AppSettings` | Current in-memory settings object (includes toggle states).              |
| `initialSettings`   | `AppSettings` | Snapshot from the last save/load, used for dirty detection.              |
| `portInput`         | `string`      | Raw string value of the port input field.                                |
| `timeoutInput`      | `string`      | Raw string value of the timeout input field.                             |
| `openCodePortInput` | `string`      | Raw string value of the OpenCode API port input field.                   |
| `saved`             | `boolean`     | True for 2 seconds after a successful save, used for "✓ Saved" feedback. |

#### `AppSettings` type (local to this file)

```ts
type AppSettings = {
  port: number;
  soundEnabled: boolean;
  launchAtLogin: boolean;
  promptTimeoutSeconds: number;
  autoRestoreSessions: boolean;
  openCodePort: number;
  docIndexingEnabled: boolean;
  noReplyInjection: boolean;
  autoStartOpenCode: boolean;
  compactMode: boolean;
};
```

#### Validation rules

| Field                  | Rule                                         |
| ---------------------- | -------------------------------------------- |
| `port`                 | Must be an integer in range `[1024, 65535]`. |
| `promptTimeoutSeconds` | Must be an integer `≥ 0`.                    |
| `openCodePort`         | Must be an integer in range `[1024, 65535]`. |

The Save button is disabled when `!isFormValid || !isDirty`.

#### Toggle switches

Boolean settings are controlled by `role="switch"` / `aria-checked` buttons: `soundEnabled`, `launchAtLogin`, `autoRestoreSessions`, `docIndexingEnabled`, `noReplyInjection`, `autoStartOpenCode`, `compactMode`.

#### Numeric inputs

Three numeric inputs: MCP Server Port, Prompt Timeout, and OpenCode API Port.

#### Info section

At the bottom, a read-only section shows:

- App version string.
- MCP config URL: `http://localhost:{settings.port}/mcp`.

---

### 6.13 `SkillsView`

**File:** `pages/SkillsView.tsx`

Full-page view for browsing, creating, editing, and deleting skills and instructions stored in the local SQLite database.

#### State

| State                | Type                         | Description                                                                |
| -------------------- | ---------------------------- | -------------------------------------------------------------------------- |
| `entries`            | `SkillOrInstruction[]`       | All entries returned by the current filter.                                |
| `tab`                | `TabType`                    | Active tab filter: `'all'`, `'skill'`, or `'instruction'`.                 |
| `search`             | `string`                     | Search query for filtering entries.                                        |
| `categoryFilter`     | `string`                     | Selected category filter (empty = all).                                    |
| `selected`           | `SkillOrInstruction \| null` | Currently selected entry shown in the detail pane.                         |
| `isEditing`          | `boolean`                    | Whether the detail pane is in edit mode for an existing entry.             |
| `isCreating`         | `boolean`                    | Whether the form is open for a brand-new entry.                            |
| `formName`           | `string`                     | Name field value in the create/edit form.                                  |
| `formType`           | `'skill' \| 'instruction'`   | Type selector value in the form.                                           |
| `formDescription`    | `string`                     | Description field value in the form.                                       |
| `formContent`        | `string`                     | Content (Markdown) textarea value in the form.                             |
| `formCategory`       | `string`                     | Category field value in the form.                                          |
| `formTags`           | `string`                     | Comma-separated tags field value.                                          |
| `saveStatus`         | `string \| null`             | Transient save feedback message, auto-cleared after 2–3 s.                 |
| `deleteTarget`       | `string \| null`             | Name of the entry pending deletion; drives the `ConfirmDeleteModal`.       |
| `exportStatus`       | `string \| null`             | Transient export feedback message ("Exported."), auto-cleared after 2.5 s. |
| `singleExportStatus` | `string \| null`             | Transient single-entry export feedback message.                            |

#### `SkillOrInstruction` type

```ts
type SkillOrInstruction = {
  id: number;
  name: string;
  type: 'skill' | 'instruction';
  description: string;
  content: string;
  enabled: boolean;
  isBuiltin: boolean;
  category: string | null;
  tags: string[] | null;
  createdAt: string;
  updatedAt: string;
};
```

#### Features

##### Tab Bar

Three tabs for filtering the list:

- **All** — Shows all entries grouped by type
- **Skills** — Shows only skills
- **Instructions** — Shows only instructions

Each tab shows a count badge.

##### Category Filter

Dropdown to filter by category. Shows all categories used by entries plus predefined categories:

- Code Review
- Testing
- Documentation
- Workflow
- Style Guide
- Other

##### Search

Real-time search filtering by:

- Entry name
- Entry description
- Tags

##### Enable/Disable Toggle

Each entry has a toggle switch to enable/disable it:

- Enabled entries are injected into agent sessions
- Disabled entries are shown with reduced opacity and "Off" badge
- Toggle is available in both sidebar items and detail view

##### Categories and Tags

- Categories organize entries into groups
- Tags provide additional metadata for searching
- Both shown as badges in the detail view
- Tags are comma-separated in the edit form

##### Duplicate

"Duplicate" button creates a copy of an entry with "(copy)" suffix, opened in edit mode.

##### Export

- "Export all" exports all entries as a ZIP file
- "Export" on individual entry exports just that entry
- Uses native save dialog

##### Built-in Indicator

Entries marked as `isBuiltin` show a "Built-in" badge.

#### Key behaviors

- **Live updates** — registers an `onSkillsUpdated` IPC listener (`window.api.onSkillsUpdated`) so the list refreshes automatically when an agent upserts or deletes an entry via the `manage_skills_and_instructions` tool.
- **Create** — clicking "+ New" opens the form with blank fields. All fields are required; the name is set permanently on creation and cannot be changed via edit.
- **Edit** — clicking "Edit" in the detail pane opens the same form pre-populated; the name field is disabled.
- **Delete** — clicking the hover-revealed "x" on a sidebar item or the "Delete" button in the detail pane sets `deleteTarget`, which opens `ConfirmDeleteModal`. Confirmed deletes call `window.api.deleteSkillOrInstruction(name)`.

#### IPC / `window.api` calls

| Method                                              | When called                                          |
| --------------------------------------------------- | ---------------------------------------------------- |
| `listSkillsAndInstructions(filterType?, category?)` | On mount, on filter change, after any CRUD operation |
| `upsertSkillOrInstruction(data)`                    | On form save (create or edit)                        |
| `deleteSkillOrInstruction(name)`                    | After delete confirmation                            |
| `toggleSkillOrInstructionEnabled(name, enabled)`    | When toggle is clicked                               |
| `duplicateSkillOrInstruction(name)`                 | When duplicate button is clicked                     |
| `exportSkillsMarkdown()`                            | On Export all button click                           |
| `exportSingleSkill(name)`                           | On single-entry Export button click                  |
| `onSkillsUpdated(callback)`                         | Registered once on mount for live updates            |

#### Sub-component: `SidebarItem`

A co-located internal component (not exported). Renders a single entry in the sidebar list. Props:

| Prop              | Type                                              | Description                              |
| ----------------- | ------------------------------------------------- | ---------------------------------------- |
| `entry`           | `SkillOrInstruction`                              | Entry data to display.                   |
| `isSelected`      | `boolean`                                         | Whether this item is currently selected. |
| `onSelect`        | `(entry: SkillOrInstruction) => void`             | Selection callback.                      |
| `onDelete`        | `(name: string) => void`                          | Triggers delete confirmation modal.      |
| `onToggleEnabled` | `(name: string, currentEnabled: boolean) => void` | Toggle enable/disable.                   |

Shows:

- Entry name with "Built-in" badge if applicable
- "Off" badge if disabled
- Category badge
- First 2 tags (with "+N" indicator for more)
- Description (truncated)
- Enable/disable toggle
- Hover-revealed delete button

---

### 6.14 `StatusBar`

**File:** `components/StatusBar.tsx`

Persistent footer bar visible across all tabs.

#### Props

| Prop              | Type                                             | Description                                                 |
| ----------------- | ------------------------------------------------ | ----------------------------------------------------------- |
| `connectionCount` | `number`                                         | Total number of active connections from `connections.size`. |
| `clientInfo`      | `{ model?: string; mode?: string } \| undefined` | Latest client info, forwarded from `useConnections`.        |
| `onShowShortcuts` | `(() => void) \| undefined`                      | Opens the `ShortcutHelpModal`.                              |

#### State

| State          | Type                                         | Description                                                             |
| -------------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| `status`       | `{ running: boolean; port: number } \| null` | Server status polled every 5 seconds.                                   |
| `restarting`   | `boolean`                                    | True while `window.api.restartMcpServer()` is in-flight.                |
| `reconnecting` | `boolean`                                    | True for 1.5 seconds after `window.api.reconnectMcpServer()` is called. |

#### Left section content

- Status dot: green (`bg-emerald-500`) when `status.running`, red (`bg-[var(--color-error)]`) otherwise.
- Label: "Restarting…" / "MCP :{port}" / "Server stopped".
- `↺` restart button: calls `restartMcpServer()` then re-polls `getServerStatus()`. Spins (`animate-spin`) while `restarting`.
- `⚡` force-reconnect button: calls `reconnectMcpServer()`. Becomes `⟳` while `reconnecting`. Colored `text-yellow-500`.
- Client count badge when `connectionCount > 0`.
- `clientInfo.model` when present (colored `--color-agent`).
- `clientInfo.mode` when present (colored `--color-user`).

#### Right section content

- Version string: "Interactive MCP v1.0.0 — 5 tools".
- Theme toggle button: shows `☀️` in dark mode (to switch to light), `🌙` in light mode (to switch to dark).
- Shortcuts button with `⌨️` icon (only if `onShowShortcuts` is defined).

---

### 6.15 `MarkdownContent`

**File:** `components/MarkdownContent.tsx`

Renders a markdown string using `react-markdown` with GitHub Flavored Markdown and syntax highlighting.

#### Props

| Prop      | Type     | Description                    |
| --------- | -------- | ------------------------------ |
| `content` | `string` | Raw markdown string to render. |

#### Key behaviors

- Uses `remarkGfm` plugin for tables, strikethrough, task lists, etc.
- Fenced code blocks with a language identifier are rendered via `react-syntax-highlighter` (`Prism`).
  - Theme: `oneDark` in dark mode, `oneLight` in light mode (determined via `useTheme()`).
  - Background override: `#111111` (dark) / `#f8fafc` (light).
- Inline `<code>` elements use standard Tailwind prose classes.
- All prose color tokens (`prose-headings`, `prose-p`, `prose-a`, etc.) are resolved through `var(--color-*)` CSS custom properties.
- Paragraph spacing is set to `prose-p:my-1` (4px top/bottom) to keep the compact chat layout while preserving visible line breaks between paragraphs.
- Requires `@tailwindcss/typography` (`@plugin '@tailwindcss/typography'` in `main.css`) for `prose` classes to take effect.

---

### 6.16 `CollapsibleSection`

**File:** `components/CollapsibleSection.tsx`

An animated expand/collapse container with a left-border accent.

#### Props

| Prop          | Type              | Default     | Description                           |
| ------------- | ----------------- | ----------- | ------------------------------------- |
| `title`       | `string`          | —           | Header label.                         |
| `defaultOpen` | `boolean`         | `false`     | Initial expanded state.               |
| `children`    | `React.ReactNode` | —           | Content rendered inside.              |
| `borderColor` | `string`          | `'#445566'` | CSS color for the left accent border. |

#### Animation

Uses CSS `max-height` transition (`duration-200 ease-in-out`). On open: `scrollHeight` → `undefined` (after 200 ms, so content can resize freely). On close: reads `scrollHeight`, then uses a double `requestAnimationFrame` to ensure the browser paints the initial height before animating to `0`.

The toggle button chevron (`▶`) rotates 90° when open via a CSS `transition-transform`.

---

### 6.17 `ShortcutHelpModal`

**File:** `components/ShortcutHelpModal.tsx`

Modal overlay listing all keyboard shortcuts. Returns `null` when `open === false`.

#### Props

| Prop      | Type         | Description                                   |
| --------- | ------------ | --------------------------------------------- |
| `open`    | `boolean`    | Controls visibility.                          |
| `onClose` | `() => void` | Called on backdrop click or ESC button click. |

#### Shortcuts listed

| Keys          | Description                  |
| ------------- | ---------------------------- |
| `⌘ + K`       | Quick Switcher               |
| `⌘ + Enter`   | Submit response              |
| `⌘ + 1`       | Prompts tab                  |
| `⌘ + 2`       | Skills tab                   |
| `⌘ + 3`       | Settings tab                 |
| `⌘ + /`       | Toggle this help             |
| `⌘ + V`       | Paste image                  |
| `Esc`         | Close autocomplete / overlay |
| `↑ ↓`         | Navigate autocomplete        |
| `Tab / Enter` | Apply autocomplete           |
| `#`           | File search                  |

Clicking the backdrop calls `onClose`; clicking inside the modal card stops propagation.

---

## 7. Type Definitions

**File:** `types.ts`

### `Attachment`

```ts
type Attachment = {
  data: string; // base64-encoded file content (no data URL prefix)
  mimeType: string;
  name: string;
  size: number; // bytes
};
```

### `PromptData`

```ts
type PromptData = {
  id: string;
  message: string;
  projectName: string;
  predefinedOptions?: string[];
  sessionId?: string;
  connectionId: string;
  connectionName: string;
  timeoutSeconds: number;
  expiresAt: number; // Unix ms timestamp when this prompt expires. 0 means no timeout.
  baseDirectory?: string;
  clientInfo?: { model?: string; mode?: string };
  openCodeSessionId?: string | null; // OpenCode session ID resolved from the DB
};
```

### `MessageKind`

```ts
type MessageKind = 'question' | 'answer' | 'outbound' | 'agent_message';
```

| Value             | Meaning                                                                  |
| ----------------- | ------------------------------------------------------------------------ |
| `'question'`      | Message sent from the agent/MCP tool to the user.                        |
| `'answer'`        | User's direct reply to a prompt.                                         |
| `'outbound'`      | User-initiated message queued for a session (not a direct prompt reply). |
| `'agent_message'` | Informational message pushed by the agent via the `send_message` tool.   |

### `ChannelMessage`

```ts
type ChannelMessage = {
  id: string;
  kind: MessageKind;
  text: string;
  timestamp: Date;
  attachments?: Attachment[];
  sent?: boolean; // True once an outbound message has been successfully injected
};
```

IDs are prefixed to indicate origin:

- `db-{n}` — loaded from the database by `loadChannelHistory`.
- `live-{timestamp}-{random}` — created by the `pushMessage` closure inside `useConnections`.
- `local-answer-{timestamp}-{random}` — optimistic answer appended by `appendAnswerMessage`.
- `local-outbound-{timestamp}-{random}` — optimistic outbound appended by `handleQueueSessionMessage`.

### `SessionStatus`

```ts
type SessionStatus = {
  status: string;
  type: 'info' | 'working' | 'success' | 'error';
  timestamp: Date;
};
```

### `PendingPermission`

```ts
type PendingPermission = {
  requestId: string;
  sessionID: string;
  permission: string;
  patterns?: string[];
  always?: boolean;
  tool?: { messageID: string; callID: string };
  metadata?: Record<string, unknown>;
};
```

### `ProviderType`

```ts
type ProviderType = 'opencode' | 'copilot-cli' | 'claude-sdk' | 'standalone';
```

### `VcsInfo`

```ts
type VcsInfo = {
  branch: string | null; // Git branch name
  additions: number; // Lines added
  deletions: number; // Lines deleted
  files: number; // Files changed
};
```

### `SessionNode`

```ts
type SessionNode = {
  id: string;
  openCodeSessionId: string | null;
  openCodeParentId: string | null;
  title: string;
  directory: string;
  depth: number;
  connectionId: string | null;
  hasMcpChannel: boolean;
  isDirectConnection: boolean;
  providerType: ProviderType | null;
  prompt: PromptData | null;
  activeSession: { id: string; title: string } | null;
  baseDirectory: string | null;
  channelMessages: ChannelMessage[];
  unreadCount: number;
  lastReadMessageId: string | null;
  hasPendingPrompt: boolean;
  sessionChannel: { sessionId: string; label?: string } | null;
  sessionStatuses: SessionStatus[];
  pendingPermissions: PendingPermission[];
  docContextEnabled?: boolean;
  vcsInfo: VcsInfo | null;
};
```

| Field                | Description                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | Renderer node key: `openCodeSessionId ?? connectionId`.                                                                                  |
| `openCodeSessionId`  | OpenCode session ID for tree-backed nodes, otherwise `null`.                                                                             |
| `openCodeParentId`   | Parent OpenCode session ID used for sidebar hierarchy, otherwise `null`.                                                                 |
| `title`              | Display label from registration or OpenCode session metadata.                                                                            |
| `connectionId`       | Persisted MCP/session-channel identifier. This is the value destructive actions and REST endpoints use.                                  |
| `providerType`       | Provider type (opencode, copilot-cli, claude-sdk, standalone).                                                                           |
| `sessionChannel`     | Renderer-visible session-channel metadata. `sessionChannel.sessionId` is the persisted identifier to use for clear/remove/queue actions. |
| `prompt`             | The currently pending `PromptData`, or `null` when idle.                                                                                 |
| `activeSession`      | Non-null while an intensive-chat session is in progress.                                                                                 |
| `baseDirectory`      | Working directory for file autocomplete and repo-doc search, if known.                                                                   |
| `channelMessages`    | Ordered list of all messages in the channel.                                                                                             |
| `unreadCount`        | Messages received while this connection was not the active selection.                                                                    |
| `lastReadMessageId`  | ID of the last message read by the user (for unread markers).                                                                            |
| `hasPendingPrompt`   | Derived indicator used for sidebar badge and tab badge logic.                                                                            |
| `sessionStatuses`    | Ordered list of status push updates for `AgentStatusBar`.                                                                                |
| `pendingPermissions` | Permission requests from OpenCode awaiting user decision.                                                                                |
| `docContextEnabled`  | Per-session toggle for doc context injection (default true).                                                                             |
| `vcsInfo`            | Git information (branch, change stats) if available.                                                                                     |

Identity summary:

- `openCodeSessionId` identifies the OpenCode session and is the preferred renderer/sidebar key when present.
- `connectionId` identifies the MCP connection and persisted session channel row.
- `sessionChannel.sessionId` mirrors the persisted session identifier exposed to renderer components.
- `activeConnectionId` is just the currently selected renderer node key; for OpenCode-backed nodes it may differ from `connectionId`.

---

## 8. Data Flow: Prompt Lifecycle

This section traces the path of a single `request_user_input` tool call from the MCP client through to the user's response.

```
MCP Client
  │
  │  (tool call: request_user_input)
  ▼
Main Process (IPC)
  │  window.api.onPromptRequest(handler)
  ▼
useConnections — onPromptRequest handler
  ├─ setClientInfo(data.clientInfo)
  ├─ findKeyByConnectionId(prevNodes, data.connectionId)
  ├─ setNodes(... prompt + hasPendingPrompt + baseDirectory ...)
  ├─ appends 'question' ChannelMessage to the owning SessionNode
  │    (increments unreadCount if that node is not active)
  ├─ setActiveConnectionId(prev => prev ?? nodeId)
  └─ activateRef.current()   // switches App to 'prompt' tab
           │
           ▼
   App re-renders → PromptView receives updated props:
     prompt = PromptData
     hasPendingPrompt = true (→ pulsing badge on sidebar / tab)
     channelMessages += new 'question' message
            │
            ▼
   PromptView renders:
     ├─ PromptMessage renders project badge + countdown (no message text)
     ├─ ChatHistoryView shows the question message with active-prompt styling
     │   └─ Predefined option buttons rendered inline below the active question
     ├─ ChannelComposer enabled, placeholder = "Type your answer…"
           │
           │  User types and presses ⌘+Enter (or clicks Send)
           ▼
  ChannelComposer.submit()
    └─ onSubmit(text, attachments)
           │
           ▼
   App.handleSubmit (from useConnections)
    ├─ appendAnswerMessage(activeConn.id, answer, attachments)
    │    └─ withNode → appends 'answer' ChannelMessage
     │                      → sets prompt: null, hasPendingPrompt: false
    └─ window.api.sendPromptResponse({ id: prompt.id, answer, attachments })
           │
           ▼
  Main Process resolves the pending MCP tool call
  and returns the answer to the MCP client.
```

### Predefined option path

When the user clicks a predefined option button in `PromptView`:

```
PromptView → onSelectOption(option)
  └─ handleSelectOption(option)
       ├─ appendAnswerMessage(activeConn.id, option)
       └─ window.api.sendPromptResponse({ id: prompt.id, answer: option })
```

### Session channel message path

When the user sends a message via the composer while no prompt is pending but a session channel is active:

```
ChannelComposer.submit()
  └─ onSubmit(text)  [no attachments in this path]
       └─ onQueueSessionMessage(sessionChannel.sessionId, text)
            ├─ window.api.queueSessionMessage(sessionId, message)
            ├─ withNode → appends 'outbound' ChannelMessage (optimistic)
            └─ window.api.injectOpenCodeMessage(...) when an `openCodeSessionId` is available
```

---

## 9. Session Tree Merge Logic

**File:** `hooks/session-tree-merge.ts`

Pure functions for merging session-tree snapshots into the renderer's SessionNode map and for partitioning nodes into SESSIONS vs DIRECT CONNECTIONS. Extracted for unit testing without React, Electron, or IPC.

### `mergeSessionTreeSnapshot`

Merges a session-tree snapshot into the existing SessionNode map.

**Rules:**

1. Every snapshot node becomes a tree entry keyed by `openCodeSessionId`.
2. If a snapshot node's `connectionId` matches an existing direct-connection node, that direct-connection's runtime state (messages, prompts, unread) is absorbed into the tree node and the direct-connection is removed.
3. Direct-connection nodes whose `connectionId` is NOT claimed by any snapshot node are preserved.
4. Topology fields always come from the snapshot; runtime state is preserved from existing nodes (or absorbed direct-connection nodes).

### `partitionNodes`

Partitions SessionNode map into two ordered lists:

- `openCodeTree`: root OpenCode sessions with their subagents in depth-first order
- `directConnections`: MCP agents with no associated OpenCode session

#### Sorting

Roots are sorted by:

1. **Running subtrees first** — sessions where the node or any descendant has `hasPendingPrompt`, busy status, or working status
2. **Unread subtrees second** — sessions where the node or any descendant has unread messages
3. **Most recent subtree activity** — sorted by latest status/message timestamp across the entire subtree (descending)

Children stay grouped under their parents in depth-first order, sorted alphabetically within each level.

### Helper functions

| Function                       | Description                                                      |
| ------------------------------ | ---------------------------------------------------------------- |
| `getLatestActivityTime`        | Get most recent activity timestamp from a single node            |
| `getSubtreeLatestActivityTime` | Get most recent activity across entire subtree (node + children) |
| `isSubtreeRunning`             | Check if node or any descendant is running                       |
| `hasSubtreeUnread`             | Check if node or any descendant has unread messages              |
| `collectSubtree`               | Recursively collect children in depth-first order                |

### `SnapshotNode` type

```ts
interface SnapshotNode {
  openCodeSessionId: string;
  openCodeParentId: string | null;
  title: string;
  directory: string;
  depth: number;
  connectionId: string | null;
  channelName: string | null;
  hasMcpChannel: boolean;
  baseDirectory: string | null;
  registeredParentSessionId: string | null;
  providerType: ProviderType | null;
  vcsInfo: VcsInfo | null;
}
```
