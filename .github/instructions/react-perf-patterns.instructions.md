---
applyTo: '**'
name: react-perf-patterns
description: Critical React and React Native performance patterns always in context. For full details, invoke the react-best-practices, react-native-skills, or composition-patterns skill.
---

# React & React Native Performance Patterns

Top CRITICAL/HIGH-impact rules from Vercel Engineering. These apply to all React code in `apps/` and `libs/`.

For the complete rule set with code examples, invoke the on-demand skills:

- `react-best-practices` — 67 web React rules
- `react-native-skills` — 35+ React Native / Expo rules
- `composition-patterns` — 8 component architecture rules

---

## Web + Shared (React)

### Eliminating Waterfalls (CRITICAL)

- **async-parallel** — Use `Promise.all()` for independent async operations. Never chain independent awaits sequentially.
- **async-defer-await** — Move `await` into the branch where the value is actually used, not at the top of the function.
- **async-cheap-condition-before-await** — Check cheap synchronous conditions (e.g., a boolean flag) before awaiting remote values.

### Bundle Size (CRITICAL)

- **bundle-barrel-imports** — Import directly from the module, not through barrel/index files.
- **bundle-dynamic-imports** — Use `React.lazy()` for heavy components not needed on initial render.
- **bundle-defer-third-party** — Load analytics, logging, and non-critical SDKs after hydration / initial render.

### Re-render Optimization (HIGH)

- **rerender-no-inline-components** — Never define components inside other components. Extract to module level.
- **rerender-derived-state-no-effect** — Derive state during render, not in effects. If you can compute it from existing props/state, do it inline — don't `useEffect` + `setState`.
- **rerender-functional-setstate** — Use functional `setState(prev => ...)` for stable callbacks instead of capturing current state.
- **rerender-lazy-state-init** — Pass a function to `useState(() => expensiveInit())`, not the result of calling it.
- **rerender-memo** — Extract expensive subtrees into `React.memo()` components when the parent re-renders frequently.

### JavaScript Performance (MEDIUM)

- **js-set-map-lookups** — Use `Set`/`Map` for O(1) lookups instead of `Array.includes()` or `.find()` in hot paths.
- **js-early-exit** — Return early from functions to avoid unnecessary computation (aligns with our coding-standards guard-clause rule).

## Component Architecture

- **architecture-avoid-boolean-props** — Don't add boolean props to customize component behavior. Use composition (children, explicit variant components) instead.
- **architecture-compound-components** — Structure complex components with shared context (compound component pattern).
- **patterns-children-over-render-props** — Prefer `children` for composition over `renderX` props.
