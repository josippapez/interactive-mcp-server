---
name: self-improve
description: Workflow for implementing user-requested changes to agent behavior across docs, skills, and instructions.
---

# self-improve

Use this skill when a user asks to change how the agent should behave in a repeatable way.

## Triggers

- New repeatable workflow or policy request.
- Existing instruction/skill behavior is ambiguous, stale, or bypassable.
- User asks to harden or simplify prompting/delegation/validation behavior.

## Required flow

1. Update owning docs first (`docs/guides` or `docs/standards`).
2. Update or add `.github/skills/**` guidance.
3. Update or add `.github/instructions/**` policy constraints.
4. If delegation mapping changes, update `.github/agents/**` and orchestration docs/instructions.
5. Validate consistency and call out exact behavior changes in handoff.

## Best practices

- Keep skills concise and docs-linked.
- Keep instructions trigger-based and deterministic.
- Prefer one canonical rule source; avoid near-duplicate policy text.

## References

- [docs/guides/agent-files.md](../../../docs/guides/agent-files.md)
- [../skill-authoring/SKILL.md](../skill-authoring/SKILL.md)
