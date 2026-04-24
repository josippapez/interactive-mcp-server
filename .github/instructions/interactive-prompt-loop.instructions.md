---
applyTo: '**'
name: interactive-prompt-loop
description: Deterministic prompt-loop policy using the built-in questions tool.
---

<!-- This is a concise summary of the prompt-loop policy. The authoritative full policy is in `user-interaction.instructions.md`, and prompt-tool selection is owned by `docs/guides/prompting-tool-selection.md`. If these files diverge, `user-interaction.instructions.md` takes precedence for enforcement. -->

Stop phrases (exact match only):

- `Stop prompting`
- `End session`
- `Don't ask anymore`
- `Close conversation`

Required rules:

1. Before starting each newly requested task in an active session, you MUST ask a scope/confirmation prompt via the **built-in questions tool**.
2. After each task delivery, you MUST ask exactly:
   `Are you satisfied with this result, or would you like any changes?`
3. You MUST maintain one active todo titled `Interactively Prompt user after [current task]`.
4. You MUST keep the todo active across cycles (`pending` -> `in_progress` -> `pending`) until an exact stop phrase.
5. You MUST mark the todo completed only when an exact stop phrase is received.
6. If a prompt times out or response is empty, you MUST re-prompt via the built-in questions tool.
7. You MUST NOT use interactive MCP prompt tools (`request_user_input`, `ask_intensive_chat`, `start_intensive_chat`, `stop_intensive_chat`, `push_session_status`, `send_message`) for in-repo agent work — that MCP path is deprecated for this repository.
8. You MUST NOT use plain-text prompting when a prompt trigger applies.
