---
name: composition-patterns
description: React composition patterns that scale. Use when refactoring components with boolean prop proliferation, building flexible component libraries, or designing reusable APIs. Triggers on tasks involving compound components, render props, context providers, or component architecture.
---

# React Composition Patterns

> Source: [vercel-labs/agent-skills/composition-patterns](https://github.com/vercel-labs/agent-skills)

Composition patterns for building flexible, maintainable React components. 8 rules across 4 categories.

## When to Apply

Reference these guidelines when:

- Refactoring components with many boolean props
- Building reusable component libraries
- Designing flexible component APIs
- Reviewing component architecture
- Working with compound components or context providers

## Quick Reference

### 1. Component Architecture (HIGH)

- `architecture-avoid-boolean-props` — Don't add boolean props to customize behavior; use composition
- `architecture-compound-components` — Structure complex components with shared context

### 2. State Management (MEDIUM)

- `state-decouple-implementation` — Provider is the only place that knows how state is managed
- `state-context-interface` — Define generic interface with state, actions, meta for dependency injection
- `state-lift-state` — Move state into provider components for sibling access

### 3. Implementation Patterns (MEDIUM)

- `patterns-explicit-variants` — Create explicit variant components instead of boolean modes
- `patterns-children-over-render-props` — Use children for composition instead of renderX props

### 4. React 19 APIs (MEDIUM)

- `react19-no-forwardref` — Don't use `forwardRef`; use `use()` instead of `useContext()`
  > ⚠️ React 19+ only. We are currently on React 18 — skip this rule until upgrade.

## Our Repo Context

- Applies to both web (`libs/web/components`) and mobile (`libs/mobile/components`) design systems
- `architecture-compound-components` aligns with our compound component patterns in shared components
- `state-decouple-implementation` aligns with presenter-consumer pattern for mobile
- See also: our [patterns skill](../patterns/SKILL.md) for additional repo-specific patterns

## Full Reference

For detailed code examples on all 8 rules, read [AGENTS.md](./AGENTS.md) in this directory or see the [upstream rules](https://github.com/vercel-labs/agent-skills/tree/main/skills/composition-patterns/rules).
