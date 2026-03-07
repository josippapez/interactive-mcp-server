---
applyTo: '**'
name: use-patterns-instructions
description: Instructions for following codebase patterns when developing features.
---

You are required to follow the established codebase patterns when assisting with development tasks.

## Pattern Documents

Before implementing features, read the relevant pattern documents in `docs/patterns/`:

- **Module creation**: Read [01-module-structure.md](docs/patterns/01-module-structure.md)
- **Component development**: Read [02-component-patterns.md](docs/patterns/02-component-patterns.md)
- **Internationalization**: Read [03-i18n-patterns.md](docs/patterns/03-i18n-patterns.md)
- **State management**: Read [04-state-management.md](docs/patterns/04-state-management.md)
- **Routing**: Read [05-routing-patterns.md](docs/patterns/05-routing-patterns.md)
- **Accessibility**: Read [06-accessibility-patterns.md](docs/patterns/06-accessibility-patterns.md)
- **Styling**: Read [07-styling-patterns.md](docs/patterns/07-styling-patterns.md)
- **Modals**: Read [08-modal-patterns.md](docs/patterns/08-modal-patterns.md)
- **Forms**: Read [09-form-patterns.md](docs/patterns/09-form-patterns.md)
- **API integration**: Read [10-api-patterns.md](docs/patterns/10-api-patterns.md)
- **Search**: Read [11-search-patterns.md](docs/patterns/11-search-patterns.md)
- **List/Grid displays**: Read [12-list-grid-patterns.md](docs/patterns/12-list-grid-patterns.md)

## Quick Reference

Consult [docs/patterns/QUICK-REFERENCE.md](docs/patterns/QUICK-REFERENCE.md) for:

- File naming conventions
- Required translation keys for features
- Modal implementation checklist
- Form implementation checklist

## Mandatory Patterns

When working on this codebase, you MUST:

1. **Follow module structure** - Create files in the correct folders following the established structure
2. **Use naming conventions** - PascalCase for components, camelCase with `use` prefix for hooks, `Atom` suffix for atoms
3. **Add module-local translations** - Add i18n keys to `<ModuleName>/<locale>.json`, never to global files
4. **Implement accessibility** - Use `type="button"` on buttons, add `aria-label` on icon buttons, use `aria-hidden="true"` on decorative icons
5. **Integrate navigation blocking** - Wire forms to `useNavigationBlocker` with the modal instance ID
6. **Use semantic tokens** - Use `text-text-*`, `bg-background-*`, `border-border-*` tokens, not hardcoded colors
7. **Lazy load modal content** - Use `lazy()` for heavy modal form components
8. **Provide toasts on mutations** - Show success/error toasts on API mutation completion

## Checklist Before Completing Tasks

- [ ] Files placed in correct module folders
- [ ] Naming conventions followed
- [ ] Translations added to module-local i18n files
- [ ] Accessibility requirements met
- [ ] Navigation blocking integrated for forms/modals
- [ ] Styling follows established patterns
- [ ] API patterns followed for queries/mutations
