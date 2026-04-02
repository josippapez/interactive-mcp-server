---
applyTo: '**'
name: interactive-prompt-loop
description: Deterministic interactive prompt-loop policy.
---

<!-- This is a concise summary of the prompt-loop policy. The authoritative full policy is in `user-interaction.instructions.md`. If the two files diverge, `user-interaction.instructions.md` takes precedence. -->

Stop phrases (exact match only):

- `Stop prompting`
- `End session`
- `Don't ask anymore`
- `Close conversation`

Required rules:

1. Before starting each newly requested task in an active session, you MUST ask a scope/confirmation prompt via interactive MCP.
2. After each task delivery, you MUST ask exactly:
   `Are you satisfied with this result, or would you like any changes?`
3. You MUST maintain one active todo titled `Interactively Prompt user after [current task]`.
4. You MUST keep the todo active across cycles (`pending` -> `in_progress` -> `pending`) until an exact stop phrase.
5. You MUST mark the todo completed only when an exact stop phrase is received.
6. If a prompt times out or response is empty, you MUST re-prompt.
7. If interactive MCP prompting returns timeout failures (for example `request timed out`, `-32001`, or equivalent timeout errors), you MUST keep prompting indefinitely with interactive prompt tools and MUST NOT fall back to plain-text completion.
8. You MUST NOT use plain-text prompting when an interactive prompt trigger applies.
