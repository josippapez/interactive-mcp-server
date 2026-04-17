---
name: add-settings-section
description: Add a new section to the Settings page — component, module-level adapter, registry entry, and SettingsSection union update. Use when adding a new settings tab/category.
when_to_use:
  - Adding a new tab/category to the Settings page.
  - Grouping a cluster of related preferences under a dedicated label in the settings sidebar.
  - Introducing a settings area backed by its own IPC handlers (e.g. Agents, OpenCode Config).
---

# Skill: add-settings-section

Adds a new registered section to the Settings page via the
`SETTINGS_SECTIONS` registry.

Pair with: [`desktop/docs/PATTERNS.md §4`](../../desktop/docs/PATTERNS.md#4-settings-section-pattern)
and [`desktop/docs/ADDING-A-FEATURE.md §4`](../../desktop/docs/ADDING-A-FEATURE.md#step-4--settings-section-component).

---

## Critical rules

1. **Adapters must be module-scoped.** Never define them inside another
   component. This is enforced by
   `react-perf-patterns: rerender-no-inline-components`.
2. **Register, don't hard-code.** New sections are added by appending to
   `SETTINGS_SECTIONS` in `section-registry.tsx`, not by editing
   `SettingsView`.
3. **Update the union type.** The `id` string must exist in the
   `SettingsSection` union in `settings-types.ts`.
4. **Section components receive `settings` + `setSettings`.** Adapters read
   the shared `SettingsStateShape` and pass only what the section needs.
5. **No early-return-then-hook.** Early-returning `null` when
   `state.settings` is falsy is fine — but only if no hook runs afterwards.

---

## Steps

### 1. Create the section component

Path: `desktop/src/renderer/src/pages/settings/SettingsSection<Name>.tsx`

Follow the shape of existing sections like `SettingsSectionBasics.tsx` or
`SettingsSectionMore.tsx`. Use `text-text-*`, `bg-background-*`,
`border-border-*` semantic tokens from Tailwind — do not hardcode colors.

### 2. Register in the registry

Edit `desktop/src/renderer/src/pages/settings/section-registry.tsx`:

```tsx
import { <Name>Section } from './SettingsSection<Name>';

// Module-scope adapter — never nest inside another component.
function <Name>Adapter({
  state,
}: {
  state: SettingsStateShape;
}): React.ReactElement | null {
  if (!state.settings) return null;
  return (
    <<Name>Section
      settings={state.settings}
      setSettings={state.setSettings}
    />
  );
}

export const SETTINGS_SECTIONS: SettingsSectionDefinition[] = [
  // …existing entries…
  {
    id: '<kebab-id>',
    label: '<Human Label>',
    icon: '<single-char-icon>',
    component: <Name>Adapter,
  },
];
```

### 3. Extend the `SettingsSection` union

Edit `desktop/src/renderer/src/pages/settings/settings-types.ts` and add the
new `'<kebab-id>'` string to the union.

### 4. If the section needs its own IPC handlers

Follow [add-ipc-handler](../add-ipc-handler/SKILL.md) first for the
main-process wiring, then have the section call the new `window.api.*`
endpoint — ideally via `useIpcQuery` / `useIpcMutation`
(see [add-renderer-hook](../add-renderer-hook/SKILL.md)).

### 5. Validate

```sh
cd desktop
npm test -- --run                    # registry integrity test must pass
npm run build
```

`section-registry.test.ts` guards against duplicate ids and missing
components — both will fail loudly at CI if you skip step 3 or introduce a
collision.

---

## Anti-patterns

- Inlining the adapter inside `SettingsView` — breaks memoisation and
  triggers unnecessary re-renders.
- Passing `state` blindly to the section component — sections should
  receive exactly the props they use; the adapter is the narrowing layer.
- Reaching into `state.settings.foo` directly from the section — always
  plumb through `settings` and `setSettings` props so the section can be
  tested against a mock settings object.

---

## Reference files

- Registry: `src/renderer/src/pages/settings/section-registry.tsx`
- Union type: `src/renderer/src/pages/settings/settings-types.ts`
- Registry test: `src/renderer/src/pages/settings/section-registry.test.ts`
- Example sections: `SettingsSectionBasics.tsx`, `SettingsSectionAgents.tsx`,
  `SettingsSectionOpenCode.tsx`
- Pattern doc: `desktop/docs/PATTERNS.md`
