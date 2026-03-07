---
name: skill-authoring
description: Skill for creating and maintaining skills in this repo based on changes in patterns, workflows, or user-facing behavior. This includes updating the skill file and the owning docs/guides/standards to ensure consistency and discoverability.
---

# skill-authoring

Create separate skills/instructions if the user requests different behaviors or patterns. Keep skills minimal and doc-first so guidance changes in one place.

## When this skill must be used

- The user asks for a new workflow/pattern that is not clearly covered by existing skills.
- The user asks to change how the agent should behave in a repeatable way.
- Existing skill guidance is ambiguous, stale, or missing required steps.

## Definition of done

This skill is considered correctly used only when all applicable steps are completed:

1. Update the owning docs first (or add the missing section) in `docs/guides` or `docs/standards`.
2. Create or update the skill file under `.github/skills/<skill-name>/SKILL.md`.
3. Keep the skill concise and reference docs instead of duplicating full guidance.
4. Add clear triggers, expected inputs/outputs, and actionable best practices.
5. Confirm the user-facing handoff mentions what skill/doc was added or updated.

## Best practices

- Point to the relevant docs (guides/standards) instead of restating rules; when guidance changes, update the doc and keep the skill slim.
- If asked to enforce a pattern, ensure the matching doc exists or add a short section there before editing the skill.
- Avoid embedding commands or hardcoded values; link to the doc sections that own them.
- Keep skills structured and terse: name/description, triggers, inputs, outputs, best practices, references.
- When a skill touches mobile code, reference docs/standards/patterns/mobile and keep mobile-specific detail in that doc.
- If a requested behavior or pattern is not covered, create a new skill (or instruction) that points to the owning doc before proceeding.

## References

- docs/standards/patterns
- docs/guides (update the specific guide before adjusting skills)
