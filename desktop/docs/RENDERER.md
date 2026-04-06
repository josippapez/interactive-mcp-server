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
   - [HistoryView](#611-historyview)
   - [SettingsView](#612-settingsview)
   - [StatusBar](#613-statusbar)
   - [MarkdownContent](#614-markdowncontent)
   - [CollapsibleSection](#615-collapsiblesection)
   - [ShortcutHelpModal](#616-shortcuthelpmodal)
7. [Type Definitions](#7-type-definitions)
8. [Data Flow: Prompt Lifecycle](#8-data-flow-prompt-lifecycle)

---

## 1. App Structure Overview

The renderer is a tab-based UI with two views: **Prompts** and **Settings**. All session/channel state lives in the `useConnections` hook and is threaded downward as props. The Prompts tab is always mounted (hidden with CSS when inactive) to avoid tearing live IPC state; the Settings tab is conditionally rendered.

Sidebar selection is keyed by `openCodeSessionId ?? connectionId`. That renderer key is not always the same as the persisted session identifier used by destructive actions. Clear/remove/dismiss actions must resolve back to `sessionChannel.sessionId` (or `connectionId`) before calling main-process APIs.

Theme preference is stored in `localStorage` and applied globally to `document.documentElement` via a `data-theme` attribute. All color tokens are CSS custom properties resolved at runtime against the current theme.

Global keyboard shortcuts are managed by `useGlobalShortcuts`, which registers a single `keydown` listener on `document` and delegates to stable refs to avoid stale closures.

---

## 2. Component Tree

```
React.StrictMode
└── ThemeProvider                          (ThemeContext.tsx)
    └── App                                (App.tsx)
        ├── <header> titlebar
        │   └── TabButton × 2             (inline in App.tsx)
        ├── <main>
        │   ├── PromptView                 (always mounted, visibility via CSS)
        │   │   ├── ChannelSidebar         (pages/PromptView.tsx)
        │   │   ├── ChannelHeader
        │   │   ├── [intensive-chat banner] (inline JSX, when activeSession)
        │   │   ├── PromptMessage          (when prompt && !activeSession — thin banner only)
        │   │   ├── ChatHistoryView        (when !idle)
        │   │   │   ├── MarkdownContent ×n
        │   │   │   └── [predefined option buttons] (inline under active question)
        │   │   ├── [awaiting reconnection state] (inline JSX)
        │   │   ├── [idle state]           (inline JSX)
        │   │   ├── AgentStatusBar         (when sessionChannel present)
        │   │   └── ChannelComposer
        │   │       ├── AutocompleteDropdown (when suggestions active)
        │   │       └── AttachmentPreview    (when attachments present)
        │   └── SettingsView               (conditional — tab === 'settings')
        │                                  (pages/SettingsView.tsx)
        ├── StatusBar                      (always visible)
        └── ShortcutHelpModal              (overlaid when showShortcuts === true)
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
| `handleSubmit`               | `(answer: string, attachments?: Attachment[]) => void`                     | Submits an answer for the active connection's pending prompt.                                                                                                                                                                                                                                                                                                                         |
| `handleSelectOption`         | `(option: string) => void`                                                 | Submits a predefined option as the answer for the active prompt.                                                                                                                                                                                                                                                                                                                      |
| `handleDismissStatus`        | `(connectionId: string, timestamp: Date) => void`                          | Removes a `SessionStatus` entry by timestamp.                                                                                                                                                                                                                                                                                                                                         |
| `handleDismissSession`       | `(connectionId: string) => void`                                           | Calls `window.api.dismissSession` with the persisted session identifier (`connectionId`).                                                                                                                                                                                                                                                                                             |
| `handleQueueSessionMessage`  | `(sessionId: string, message: string, attachments?: Attachment[]) => void` | Queues a message for the session via `window.api.queueSessionMessage` and optimistically appends an `'outbound'` message to `channelMessages`. When an OpenCode session is active, also calls `window.api.injectOpenCodeMessage`; image attachments are saved to the persistent attachment store and referenced by `/attachments/:filename` URLs, while text attachments are inlined. |
| `handleClearChannelMessages` | `(sessionId: string) => void`                                              | Calls `window.api.clearSessionChannelMessages` to clear DB history for the session.                                                                                                                                                                                                                                                                                                   |
| `handleRemoveSession`        | `(sessionId: string) => void`                                              | Calls `window.api.removeSessionChannel` to delete the session channel entirely.                                                                                                                                                                                                                                                                                                       |

#### Internal design

**Listener registration guard:** IPC listeners are registered inside a `useEffect` that runs once. The `listenersRegistered` ref prevents double-registration in `React.StrictMode`.

**Stable refs pattern:** `onActivatePromptTab` and `activeConnectionId` are mirrored to refs (`activateRef`, `activeConnectionRef`) so that event callbacks registered at mount time always access the latest values without needing to re-register.

**`withNode` helper:** All state mutations go through `withNode(nodeId, updater)`, which performs a safe `Map` clone and applies the updater only if the node exists.

#### IPC events handled

| Event                             | Effect                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onSessionTreeUpdated`            | Rebuilds renderer topology from the latest full snapshot, preserving runtime state and loading history for newly claimed `connectionId`s.                     |
| `onConnectionOpened`              | Adds a direct-connection node keyed by `connectionId` when no OpenCode-backed node already owns that connection; loads channel history; activates prompt tab. |
| `onConnectionClosed`              | Removes only direct-connection nodes. OpenCode-backed nodes are governed by later session-tree snapshots or explicit deletion events.                         |
| `onPromptRequest`                 | Sets `prompt` and `hasPendingPrompt` on the connection; appends a `'question'` channel message; updates `clientInfo`; activates prompt tab.                   |
| `onIntensiveChatStart`            | Sets `activeSession` (`{ id, title }`) on the connection; activates prompt tab.                                                                               |
| `onIntensiveChatStop`             | Clears `activeSession` to `null`.                                                                                                                             |
| `onSessionStatusUpdate`           | Appends a new `SessionStatus` to `sessionStatuses`.                                                                                                           |
| `onSessionChannelDeleted`         | Removes the owning node by persisted session identifier (`connectionId`) or direct node key; clears active selection if it matched.                           |
| `onSessionChannelMessagesCleared` | Resets `channelMessages` and `unreadCount` to empty/zero.                                                                                                     |

#### Startup/session reconciliation flow

The renderer now reconciles against full `session-tree-updated` snapshots instead of maintaining a separate restored-tab model.

- `session-tree-updated` supplies all live OpenCode sessions enriched with `registered_connections` metadata.
- `mergeSessionTreeSnapshot` rebuilds the node map using `openCodeSessionId ?? connectionId` keys while preserving runtime state such as prompts, messages, unread counts, and statuses.
- If a snapshot node claims a `connectionId` that previously existed as a direct connection, the direct node's runtime state is absorbed into the OpenCode-keyed node.
- History is loaded once per claimed `connectionId` via `getSessionChannelHistory(connectionId)`.
- Direct MCP connections with no OpenCode session remain keyed by `connectionId` and are preserved until explicitly removed or closed.

#### Unread count logic

When a message targets a node that is **not** the currently active one, `unreadCount` is incremented. It resets to `0` whenever that node becomes active.

---

### 5.2 `useIpcListeners`

**File:** `hooks/useIpcListeners.ts`

Extracted hook that registers all Electron IPC event listeners (`onConnectionOpened`, `onConnectionClosed`, `onPromptRequest`, `onIntensiveChatStart`, `onIntensiveChatStop`, `onSessionStatusUpdate`, `onSessionChannelCreated`, `onSessionChannelDeleted`, `onSessionChannelMessagesCleared`, `onAgentMessage`, `onSessionTreeUpdated`). Called once by `useConnections`. Keeps listener registration behind a `listenersRegistered` ref to prevent double-registration in `React.StrictMode`.

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

Registers a single `keydown` listener on `document` for application-wide keyboard shortcuts. Uses refs to keep `showShortcuts` state and `onSwitchTab` stable inside the handler.

#### Parameters

| Parameter     | Type                    | Description                                         |
| ------------- | ----------------------- | --------------------------------------------------- |
| `onSwitchTab` | `(tab: 1 \| 2) => void` | Callback to switch the active tab by 1-based index. |

#### Returned values

| Value            | Type         | Description                                 |
| ---------------- | ------------ | ------------------------------------------- |
| `showShortcuts`  | `boolean`    | Whether the `ShortcutHelpModal` is visible. |
| `openShortcuts`  | `() => void` | Sets `showShortcuts` to `true`.             |
| `closeShortcuts` | `() => void` | Sets `showShortcuts` to `false`.            |

#### Shortcut bindings

| Key combo       | Condition                                  | Action                     |
| --------------- | ------------------------------------------ | -------------------------- |
| `⌘1` / `Ctrl+1` | —                                          | Switch to Prompts tab      |
| `⌘2` / `Ctrl+2` | —                                          | Switch to Settings tab     |
| `⌘/` / `Ctrl+/` | —                                          | Toggle shortcut help modal |
| `?`             | Target is not `<textarea>` or `<input>`    | Toggle shortcut help modal |
| `Escape`        | Modal is open (`showRef.current === true`) | Close shortcut help modal  |

---

### 5.8 `useTheme`

**File:** `ThemeContext.tsx`

```ts
function useTheme(): { theme: Theme; toggle: () => void };
```

Thin wrapper around `useContext(ThemeContext)`. Returns the current theme and a stable `toggle` callback (memoized with `useCallback`). Must be called within a component tree wrapped by `ThemeProvider`.

---

## 6. Components

### 6.1 `App`

**File:** `App.tsx`

The root component. Owns tab state and orchestrates the top-level layout.

#### State

| State       | Type                     | Initial    | Description            |
| ----------- | ------------------------ | ---------- | ---------------------- |
| `activeTab` | `'prompt' \| 'settings'` | `'prompt'` | Currently visible tab. |

#### Key behaviors

- Calls `useConnections(switchToPrompt)` where `switchToPrompt` is a stable `useCallback` that sets `activeTab` to `'prompt'`.
- Calls `useGlobalShortcuts({ onSwitchTab: switchTab })` to wire keyboard shortcuts.
- Derives `hasAnyPrompt` by scanning `connections.values()` for any entry where `hasPendingPrompt === true`.
- Renders the Prompts tab wrapped in a div that uses `className="hidden"` when inactive rather than unmounting, preserving all hook and IPC state.
- `SettingsView` is conditionally rendered (`{activeTab === 'settings' && <SettingsView />}`), so it mounts/unmounts on tab switch.
- Shows a pulsing badge on the Prompts `TabButton` when `hasAnyPrompt && activeTab !== 'prompt'`.

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

The main prompt interaction view. Renders the two-column layout: a fixed-width sidebar on the left and a flexible content area on the right.

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
| `onSubmit`              | `(answer, attachments?) => void`                | Forward to `handleSubmit` from `useConnections`.                                                    |
| `onSelectOption`        | `(option) => void`                              | Forward to `handleSelectOption`.                                                                    |
| `onDismissStatus`       | `(connectionId, timestamp) => void`             | Forward to `handleDismissStatus`.                                                                   |
| `onDismissSession`      | `(connectionId) => void`                        | Forward to `handleDismissSession`.                                                                  |
| `onQueueSessionMessage` | `(sessionId, message, attachments?) => void`    | Forward to `handleQueueSessionMessage`.                                                             |
| `onClearMessages`       | `(sessionId) => void`                           | Forward to `handleClearChannelMessages`.                                                            |
| `onRemoveSession`       | `(sessionId) => void`                           | Forward to `handleRemoveSession`.                                                                   |

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

Lists all session nodes as clickable channel buttons. Wrapped in `React.memo`.

#### Props

| Prop                 | Type                       | Description                              |
| -------------------- | -------------------------- | ---------------------------------------- |
| `connections`        | `Map<string, SessionNode>` | All session nodes.                       |
| `activeConnectionId` | `string \| null`           | Currently selected sidebar node key.     |
| `onSelect`           | `(id: string) => void`     | Called when a channel button is clicked. |

#### Key behaviors

- Iterates `connections.values()` to build the list.
- Each button label is `conn.sessionChannel?.label ?? conn.title`.
- Active channel receives `bg-[var(--color-agent)]/15 text-[var(--color-agent)]` styling.
- Pulsing dot badge (colored `var(--color-user)`) shown when `conn.hasPendingPrompt === true`.
- Numeric unread count badge shown when `!conn.hasPendingPrompt && conn.unreadCount > 0`.
- The rendered hierarchy comes from the latest `session-tree-updated` snapshot. OpenCode-backed nodes use `depth`/`openCodeParentId`; direct connections remain keyed by `connectionId`.

---

### 6.4 `ChannelHeader`

**File:** `components/prompt/ChannelHeader.tsx`

Displays the active channel label and action buttons at the top of the content area.

#### Props

| Prop               | Type         | Description                                              |
| ------------------ | ------------ | -------------------------------------------------------- |
| `label`            | `string`     | Channel label (session label or connection ID).          |
| `promptActive`     | `boolean`    | If true, shows a "pending prompt" badge.                 |
| `onClearMessages`  | `() => void` | Clears Q/A history and queued messages.                  |
| `onRemoveSession`  | `() => void` | Removes session channel and terminates it if active.     |
| `onDismissSession` | `() => void` | Closes the tab from the UI without removing the session. |

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

Scrollable list of all `ChannelMessage` entries for the current connection.

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

### 6.11 `SettingsView`

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

Six boolean settings are controlled by `role="switch"` / `aria-checked` buttons: `soundEnabled`, `launchAtLogin`, `autoRestoreSessions`, `docIndexingEnabled`, `noReplyInjection`, `autoStartOpenCode`.

#### Numeric inputs

Three numeric inputs: MCP Server Port, Prompt Timeout, and OpenCode API Port.

#### Info section

At the bottom, a read-only section shows:

- App version string.
- MCP config URL: `http://localhost:{settings.port}/mcp`.

---

### 6.12 `StatusBar`

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

### 6.13 `MarkdownContent`

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

### 6.14 `CollapsibleSection`

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

### 6.15 `ShortcutHelpModal`

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
| `⌘ + Enter`   | Submit response              |
| `⌘ + 1`       | Prompts tab                  |
| `⌘ + 2`       | Settings tab                 |
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
  baseDirectory?: string;
  clientInfo?: { model?: string; mode?: string };
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
  prompt: PromptData | null;
  activeSession: { id: string; title: string } | null;
  baseDirectory: string | null;
  channelMessages: ChannelMessage[];
  unreadCount: number;
  hasPendingPrompt: boolean;
  sessionChannel: { sessionId: string; label?: string } | null;
  sessionStatuses: SessionStatus[];
};
```

| Field               | Description                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | Renderer node key: `openCodeSessionId ?? connectionId`.                                                                                  |
| `openCodeSessionId` | OpenCode session ID for tree-backed nodes, otherwise `null`.                                                                             |
| `openCodeParentId`  | Parent OpenCode session ID used for sidebar hierarchy, otherwise `null`.                                                                 |
| `title`             | Display label from registration or OpenCode session metadata.                                                                            |
| `connectionId`      | Persisted MCP/session-channel identifier. This is the value destructive actions and REST endpoints use.                                  |
| `sessionChannel`    | Renderer-visible session-channel metadata. `sessionChannel.sessionId` is the persisted identifier to use for clear/remove/queue actions. |
| `prompt`            | The currently pending `PromptData`, or `null` when idle.                                                                                 |
| `activeSession`     | Non-null while an intensive-chat session is in progress.                                                                                 |
| `baseDirectory`     | Working directory for file autocomplete and repo-doc search, if known.                                                                   |
| `channelMessages`   | Ordered list of all messages in the channel.                                                                                             |
| `unreadCount`       | Messages received while this connection was not the active selection.                                                                    |
| `hasPendingPrompt`  | Derived indicator used for sidebar badge and tab badge logic.                                                                            |
| `sessionStatuses`   | Ordered list of status push updates for `AgentStatusBar`.                                                                                |

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
