---
applyTo: '.github/**,docs/guides/**,docs/standards/**'
name: self-improve-instructions
description: Route repeatable behavior-change requests through a docs-first, skills+instructions synchronized workflow.
---

Use this rule when the user asks to change repeatable agent behavior.

Required sequence:

1. Update owning docs first (`docs/guides` or `docs/standards`).
2. Update/create the corresponding `.github/skills/**` workflow.
3. Update/create the corresponding `.github/instructions/**` policy.
4. If orchestration behavior changes, update agent mapping and `.github/agents/**` templates in the same task.
5. Validate changed files and report the exact behavioral delta in handoff.

Delegation:

- Prefer delegating these requests to `self-improve-specialist` when the task is more than a trivial single-line tweak.
