---
name: codebase-patterns
title: Codebase Patterns & Conventions
description: Comprehensive patterns for modules, components, i18n, state, routing, accessibility, styling, modals, forms, API, search, and list/grid displays.
version: 0.1.0
---

# codebase-patterns

This skill provides guidance on all codebase patterns and conventions. See individual pattern documents in `docs/patterns/` for detailed instructions.

## Pattern Documents

| Pattern          | Description                      | File                                                                       |
| ---------------- | -------------------------------- | -------------------------------------------------------------------------- |
| Module Structure | How modules are organized        | [01-module-structure.md](docs/patterns/01-module-structure.md)             |
| Components       | Naming, lazy loading, forwardRef | [02-component-patterns.md](docs/patterns/02-component-patterns.md)         |
| i18n             | Internationalization setup       | [03-i18n-patterns.md](docs/patterns/03-i18n-patterns.md)                   |
| State Management | Jotai atoms                      | [04-state-management.md](docs/patterns/04-state-management.md)             |
| Routing          | TanStack Router patterns         | [05-routing-patterns.md](docs/patterns/05-routing-patterns.md)             |
| Accessibility    | ARIA, semantic HTML, focus       | [06-accessibility-patterns.md](docs/patterns/06-accessibility-patterns.md) |
| Styling          | Tailwind, CVA, grid system       | [07-styling-patterns.md](docs/patterns/07-styling-patterns.md)             |
| Modals           | Single-step and multi-step       | [08-modal-patterns.md](docs/patterns/08-modal-patterns.md)                 |
| Forms            | React Hook Form patterns         | [09-form-patterns.md](docs/patterns/09-form-patterns.md)                   |
| API              | Orval, queries, mutations        | [10-api-patterns.md](docs/patterns/10-api-patterns.md)                     |
| Search           | Search atoms and components      | [11-search-patterns.md](docs/patterns/11-search-patterns.md)               |
| List/Grid        | Lists, pagination, displays      | [12-list-grid-patterns.md](docs/patterns/12-list-grid-patterns.md)         |

## Quick Reference

See [docs/patterns/QUICK-REFERENCE.md](docs/patterns/QUICK-REFERENCE.md) for:

- File naming conventions
- Required translation keys
- Modal checklist
- Form checklist

## When to Use

Read the relevant pattern documents when:

- Creating a new module or feature
- Adding components, hooks, or atoms
- Implementing forms or modals
- Setting up i18n for a new module
- Adding search functionality
- Creating list/grid displays with pagination
- Ensuring accessibility compliance
- Working with API integrations

## Best Practices

- Follow the established module folder structure
- Use the naming conventions consistently
- Integrate navigation blockers with modals and forms
- Use semantic color tokens, not hardcoded colors
- Lazy-load heavy components, especially modal bodies
- Provide proper ARIA labels for interactive elements
- Use the `cn()` utility for conditional class names
- Always add translations to module-local i18n files, not global ones
