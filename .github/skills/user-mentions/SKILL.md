---
name: user-mentions
description: Always re-open user-referenced files before updating code or generators.
---

# user-mentions

When a user points to specific files, instructions or skill, or says they updated them, re-read them (and their generator counterparts, if any) before making changes that affect those files.

## Best practices

- Open the mentioned files to mirror their current state; if generators mirror them, open the matching templates under tools/nx-plugin/ and update both.
- If a referenced file cannot be found, search the workspace or ask the user for the correct path before proceeding.

## References

- Relevant docs/guides depending on the change
- [skill-authoring](../skill-authoring/SKILL.md) for how to update skills and docs when patterns change
- [workspace-hygiene](../workspace-hygiene/SKILL.md) for keeping the repo clean and up to date after changes
- [prompt-user](../prompt-user/SKILL.md) for how to ask the user for clarifications or confirmations when needed
- [docs-upkeep](../docs-upkeep/SKILL.md) for how to maintain the accuracy and relevance of documentation when code changes
- [patterns](../patterns/SKILL.md) for how to follow and update established patterns in the codebase when making changes
- [design-system](../design-system/SKILL.md) for how to maintain consistency in UI components and styles when updating code that affects the frontend
