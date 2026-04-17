# Adding a feature — end-to-end walkthrough

Step-by-step guide for adding a typical new feature that spans main, preload,
and renderer. The worked example throughout is **adding a new Settings section
called "Notifications"**. Adapt the steps to your own feature.

For pattern reference, see [PATTERNS.md](./PATTERNS.md). For agent-facing
versions of these steps, see
[`.agents/skills/`](../../.agents/skills/).

---

## Worked example: "Notifications" settings section

Goal: a new tab in the Settings page with one or more user-controllable
notification preferences, persisted through the existing settings store, and
with a dedicated IPC endpoint (e.g. "send test notification").

---

### Step 1 — Main-process IPC handler

Create `desktop/src/main/ipc/handlers/notifications-handlers.ts`:

```ts
import { ipcMain } from 'electron';
import { withIpcResult } from './ipc-result';
import { logIpcInfo } from './shared';

export function registerNotificationsHandlers(): void {
  ipcMain.handle(
    'send-test-notification',
    withIpcResult(async (_event, message: string) => {
      logIpcInfo(`send-test-notification: ${message}`);
      // …business logic that returns a value (or null)…
      return null;
    }),
  );
}
```

Error handling is done for you by `withIpcResult`. Throw an `Error` (with
`{ cause }` if you are rewrapping) for failures — the wrapper converts it to
`{ ok: false, error }`.

Reference: [PATTERNS.md §1 — IPC handler pattern](./PATTERNS.md#1-ipc-handler-pattern).

---

### Step 2 — Register the handler

Edit `desktop/src/main/ipc/handlers.ts`:

```ts
import { registerNotificationsHandlers } from './handlers/notifications-handlers';

export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  // …existing registrations…
  registerNotificationsHandlers();
}
```

Registration order matters only when two handlers claim the same channel
name (vitest's `handlers.test.ts` will catch duplicates).

---

### Step 3 — Preload surface

Two locations coexist. **For a new feature with ≥2 methods**, use the split
module form:

1. Create `desktop/src/preload/api/notifications.ts`:

   ```ts
   import { ipcRenderer } from 'electron';

   export function createNotificationsApi() {
     return {
       sendTestNotification: (
         message: string,
       ): Promise<{ ok: true; data: null } | { ok: false; error: string }> =>
         ipcRenderer.invoke('send-test-notification', message),
     };
   }
   ```

2. Wire it into `desktop/src/preload/index.ts` by spreading the factory
   output into the `api` object (follow the pattern used by agents/opencode
   split modules).

**For a single one-off endpoint**, adding the method directly to the `api`
object in `src/preload/index.ts` is still acceptable — the codebase has both
styles.

Reference: [PATTERNS.md §2 — Preload surface pattern](./PATTERNS.md#2-preload-surface-pattern).

---

### Step 4 — Settings section component

1. Create `desktop/src/renderer/src/pages/settings/SettingsSectionNotifications.tsx`
   exporting a `NotificationsSection` component. Receive `settings` + `setSettings`
   from props (same shape as the existing `PreferencesSection`).

2. Add a module-scoped adapter and register it in
   `src/renderer/src/pages/settings/section-registry.tsx`:

   ```tsx
   import { NotificationsSection } from './SettingsSectionNotifications';

   function NotificationsAdapter({
     state,
   }: {
     state: SettingsStateShape;
   }): React.ReactElement | null {
     if (!state.settings) return null;
     return (
       <NotificationsSection
         settings={state.settings}
         setSettings={state.setSettings}
       />
     );
   }

   export const SETTINGS_SECTIONS: SettingsSectionDefinition[] = [
     // …existing entries…
     {
       id: 'notifications',
       label: 'Notifications',
       icon: '🔔',
       component: NotificationsAdapter,
     },
   ];
   ```

3. Add `'notifications'` to the `SettingsSection` union in
   `src/renderer/src/pages/settings/settings-types.ts`.

Adapters MUST live at module scope — never define them inside another
component (react-perf-patterns: `rerender-no-inline-components`).

Reference: [PATTERNS.md §4 — Settings section pattern](./PATTERNS.md#4-settings-section-pattern).

---

### Step 5 — Tests for each pure helper

For any logic richer than a pass-through, extract it into a pure helper
module and add a co-located `.test.ts`. Examples of good extractions:

- `notifications-merge.ts` — merging user preferences into the persisted
  settings shape.
- `notifications-format.ts` — building the notification payload string.

The section component itself is typically not unit-tested (env is `node`,
not jsdom); coverage lives in the pure helpers.

Reference: [PATTERNS.md §6 — Testing conventions](./PATTERNS.md#6-testing-conventions).

---

### Step 6 — Validation

```sh
npm test -- --run
npm run build
```

Both must pass. If you touched any shared type, also run
`npm run check-types` from the repo root.

---

## Quick checklist

- [ ] New handler module under `src/main/ipc/handlers/`, all handlers
      wrapped with `withIpcResult`.
- [ ] `registerXHandlers()` exported and called from
      `src/main/ipc/handlers.ts`.
- [ ] Preload endpoint added (split module preferred for multi-method
      features).
- [ ] Renderer consumption uses `useIpcQuery` / `useIpcMutation` where
      applicable.
- [ ] For settings: section component, module-level adapter, registry
      entry, and `SettingsSection` union updated.
- [ ] Pure helpers extracted and co-located `.test.ts` added.
- [ ] Errors rewrapped with `new Error(msg, { cause: err })`.
- [ ] `npm test -- --run` and `npm run build` both pass.

---

## Agent-facing versions

- [add-ipc-handler](../../.agents/skills/add-ipc-handler/SKILL.md)
- [add-settings-section](../../.agents/skills/add-settings-section/SKILL.md)
- [add-renderer-hook](../../.agents/skills/add-renderer-hook/SKILL.md)
- [add-custom-agent-or-tool](../../.agents/skills/add-custom-agent-or-tool/SKILL.md)
