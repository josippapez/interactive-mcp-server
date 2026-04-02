---
name: react-best-practices
description: React performance optimization guidelines from Vercel Engineering. Use when writing, reviewing, or refactoring React code to ensure optimal performance patterns. Triggers on tasks involving React components, data fetching, bundle optimization, or performance improvements.
---

# Vercel React Best Practices

> Source: [vercel-labs/agent-skills/react-best-practices](https://github.com/vercel-labs/agent-skills)

Comprehensive performance optimization guide for React applications. Contains 67 rules across 8 categories, prioritized by impact.

## When to Apply

Reference these guidelines when:

- Writing new React components or pages
- Implementing data fetching (client or server-side)
- Reviewing code for performance issues
- Refactoring existing React code
- Optimizing bundle size or load times

## Rule Categories by Priority

| Priority | Category                  | Impact      | Prefix       |
| -------- | ------------------------- | ----------- | ------------ |
| 1        | Eliminating Waterfalls    | CRITICAL    | `async-`     |
| 2        | Bundle Size Optimization  | CRITICAL    | `bundle-`    |
| 3        | Server-Side Performance   | HIGH        | `server-`    |
| 4        | Client-Side Data Fetching | MEDIUM-HIGH | `client-`    |
| 5        | Re-render Optimization    | MEDIUM      | `rerender-`  |
| 6        | Rendering Performance     | MEDIUM      | `rendering-` |
| 7        | JavaScript Performance    | LOW-MEDIUM  | `js-`        |
| 8        | Advanced Patterns         | LOW         | `advanced-`  |

## Quick Reference — Top Rules

### 1. Eliminating Waterfalls (CRITICAL)

- `async-parallel` — Use Promise.all() for independent operations
- `async-defer-await` — Move await into branches where actually used
- `async-cheap-condition-before-await` — Check cheap sync conditions before awaiting
- `async-suspense-boundaries` — Use Suspense to stream content

### 2. Bundle Size Optimization (CRITICAL)

- `bundle-barrel-imports` — Import directly, avoid barrel files
- `bundle-dynamic-imports` — Use dynamic imports for heavy components
- `bundle-defer-third-party` — Load analytics/logging after hydration
- `bundle-conditional` — Load modules only when feature is activated

### 3. Re-render Optimization (MEDIUM)

- `rerender-memo` — Extract expensive work into memoized components
- `rerender-derived-state` — Subscribe to derived booleans, not raw values
- `rerender-derived-state-no-effect` — Derive state during render, not effects
- `rerender-functional-setstate` — Use functional setState for stable callbacks
- `rerender-no-inline-components` — Don't define components inside components
- `rerender-lazy-state-init` — Pass function to useState for expensive values

### 4. JavaScript Performance (LOW-MEDIUM)

- `js-set-map-lookups` — Use Set/Map for O(1) lookups
- `js-early-exit` — Return early from functions
- `js-combine-iterations` — Combine multiple filter/map into one loop

## Our Repo Context

- **Web app**: `apps/HCP-Portal` (Vite + TanStack Router, NOT Next.js)
- Skip Next.js-specific rules (RSC, `next/dynamic`, `after()`) — use Vite equivalents
- `bundle-barrel-imports` is especially important — our Nx monorepo has many index.ts barrel files
- `rerender-*` rules apply directly to our TanStack Query + Zustand patterns
- Use `React.lazy()` instead of `next/dynamic` for code splitting
- See also: our [coding-standards instruction](../../instructions/coding-standards.instructions.md) for repo-specific React/TS patterns

## Full Reference

For detailed code examples on all 67 rules, read [AGENTS.md](./AGENTS.md) in this directory or see the [upstream rules](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices/rules).
