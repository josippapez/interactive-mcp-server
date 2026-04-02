---
name: prompt-user
description: Run user-facing prompt loops with request_user_input for scope confirmation, decision collection, and mandatory post-delivery satisfaction checks.
---

# prompt-user

Use this skill for any user-facing prompt workflow.

- [../../instructions/interactive-prompt-loop.instructions.md](../../instructions/interactive-prompt-loop.instructions.md)

## Required behavior

1. Use `request_user_input` for prompts.
2. Do not use built-in `askQuestions`.
3. Before starting each newly requested task in an active session, ask at least one scope/confirmation prompt.
4. After any task output/delivery, ask exactly:
   `Are you satisfied with this result, or would you like any changes?`
5. Prompting MUST stop only on these exact phrases:
   - `Stop prompting`
   - `End session`
   - `Don't ask anymore`
   - `Close conversation`
6. Any non-stop outcome MUST continue the active loop and trigger re-prompting:
   - non-stop user replies (including acknowledgements and new task requests)
   - prompt timeout or empty response
   - prompt decline/cancel/dismiss
   - prompt tool failure
7. Tool-failure fallback: retry `request_user_input` indefinitely; MUST NOT fall back to plain text or any non-interactive-MCP tool per `user-interaction.instructions.md`.
8. Interactive timeout hardening: when interactive MCP calls fail with timeout signals (for example `request timed out`, `-32001`, or equivalent), you MUST keep prompting indefinitely with interactive prompt tools and MUST NOT complete via plain text.
9. Plain-text completion fallback is forbidden for interactive timeout/tool failures.
10. Plain-text prompts are never an acceptable fallback.
11. If implementation is still pending (report/diff checkpoint only), ask whether to implement next and keep prompting.
12. After system-notification-driven outputs, include the mandatory satisfaction prompt again.
13. Maintain one persistent prompt-loop todo titled `Interactively Prompt user after [current task]`; keep it active across task cycles and only complete it on an exact stop phrase.

## Trigger cases

- Task start, ambiguity, competing options, conflicts, skipped commands, and post-notification outputs.
- Any situation defined in [../../instructions/interactive-prompt-loop.instructions.md](../../instructions/interactive-prompt-loop.instructions.md).

## Prompt quality

- Keep prompts concise and action-oriented.
- Include predefined options whenever practical.
- Never ask for secrets or unnecessary personal data.

## Prompt-loop todo pattern

- At task start: create/keep `Interactively Prompt user after [current task]` as `pending`.
- After sending the satisfaction prompt: set it to `in_progress`.
- On any non-stop user reply: reset it to `pending` for the next task.
- On exact stop phrase only: mark it `completed`.
