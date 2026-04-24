---
name: prompt-user
description: Run user-facing prompt loops with the built-in questions tool. Use when you need scope confirmation, decision collection, or mandatory post-delivery satisfaction checks. Triggers include asking clarifying questions and collecting choices.
---

# prompt-user

Use this skill for any user-facing prompt workflow.

- [../../../docs/guides/prompting-tool-selection.md](../../../docs/guides/prompting-tool-selection.md)
- [../../instructions/interactive-prompt-loop.instructions.md](../../instructions/interactive-prompt-loop.instructions.md)

## Required behavior

1. Use the **built-in questions tool** (harness-provided `question` / `ask_question` / equivalent) for every prompt.
2. Do NOT use interactive MCP prompt tools (`request_user_input`, `ask_intensive_chat`, `start_intensive_chat`, `stop_intensive_chat`, `push_session_status`, `send_message`) for in-repo agent work — that MCP path is deprecated for this repository.
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
7. Plain-text completion fallback is forbidden — re-prompt with a shorter, option-driven question instead.
8. If implementation is still pending (report/diff checkpoint only), ask whether to implement next and keep prompting.
9. After system-notification-driven outputs, include the mandatory satisfaction prompt again.
10. Maintain one persistent prompt-loop todo titled `Interactively Prompt user after [current task]`; keep it active across task cycles and only complete it on an exact stop phrase.

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
