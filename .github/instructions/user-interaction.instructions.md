---
applyTo: '**'
name: user-interaction-instructions
description: Instructions for interacting, prompting general communication, and asking questions using the built-in questions tool.
---

Use this file as a strict policy. Do not interpret these rules loosely.

## Canonical policy

- Follow `docs/guides/prompting-tool-selection.md` as the owning source for prompt-tool selection.

## Mandatory tool usage

- You MUST use the **built-in questions tool** (the harness-provided question/ask-question tool) for all interactive communication with the user.
- You MUST NOT use `interactive` MCP server prompts (`request_user_input`, `ask_intensive_chat`, `start_intensive_chat`, `stop_intensive_chat`, `push_session_status`, `send_message`) for in-repo agent work. That MCP path is deprecated for this repository's agent guidance, though the tool implementations remain in `desktop/src/main/tools/` for external consumers.
- You MUST NOT exit the prompt loop until the user explicitly indicates they want to stop being prompted, even if they are unresponsive or keep giving empty responses.
- You MUST NOT send plain-text-only user-facing replies when a prompt trigger applies; use the built-in questions tool in that same response.

## System-notification clarification

- System notifications (for example command completion/background updates) are **not** a valid reason to skip prompting.
- If you send a user-facing reply after processing a system notification, all normal prompt-trigger rules still apply.
- If that reply is a completion/handoff, you MUST run the mandatory satisfaction prompt via the built-in questions tool in the same response.

## Required prompt triggers

You MUST ask the user via the built-in questions tool in all of the following situations:

1. Before any task, even when requirements look clear.
2. After any task, to run the satisfaction check — and update the prompt-loop todo accordingly (see [Prompt-loop task tracking](#prompt-loop-task-tracking)).
3. When any requirement is ambiguous, even slightly.
4. When multiple implementation approaches are possible.
5. When you need the user to choose or confirm a design/behavior decision.
6. When the user asks to be prompted, asked, asks questions, or provides suggestions.
7. When the user asks a direct question, including reply questions.
8. If the user skips a command you asked them to run.
9. If user instructions are conflicting or unclear at any point during implementation.
10. Immediately before any final/closing handoff.
11. When any unexpected situation arises that requires user input.
12. When satisfactory check is done but the user has not USED a stop phrase.
13. When replying after system notifications and presenting task output/handoff to the user.

## Active question tool

- The active question tool is the **built-in questions tool** at all times.
- There is no fallback or alternate path. Interactive MCP prompting is disabled for this repository.

## Per-turn enforcement

- In every assistant turn during an active session, if a prompt trigger applies, you MUST include a built-in-questions-tool prompt in that same turn. Plain-text-only turns are forbidden when a trigger applies.
- If a required prompt was missed in the previous turn, the next turn MUST begin with a corrective prompt via the built-in questions tool before any additional work.
- Every turn where a prompt is sent or a task begins MUST also update the prompt-loop todo via TodoWrite (see [Prompt-loop task tracking](#prompt-loop-task-tracking)).

## Mandatory satisfaction check

You MUST ask exactly:

`Are you satisfied with this result, or would you like any changes?`

You MUST NOT skip this step, including for simple or obvious tasks. And you MUST NOT infer satisfaction as a session stopping condition. Always ask for explicit confirmation, and continue prompting until the user explicitly indicates they want to stop being prompted.
You MUST NOT send satisfaction check prompts as plain text; they MUST be sent using the built-in questions tool.

## Follow-up continuity rule (anti-stop safeguard)

- If the user sends any follow-up request/question after a satisfaction prompt and does not use an exact stop phrase, the session is still active.
- You MUST treat that follow-up as an active session continuation: complete the requested work and continue the mandatory prompt loop.
- In every subsequent user-facing response where a prompt trigger applies, you MUST include the required built-in-questions-tool prompt in that same response.
- You MUST NOT send plain-text-only follow-up/completion replies when a prompt trigger applies.
- After each follow-up task completion, you MUST ask the mandatory satisfaction question again via the built-in questions tool.
- This applies even when the follow-up is only "explain", "show diff", or any brief clarification.

## Session stop phrases

You MUST continue the prompt loop until the user explicitly uses one of these exact phrases:

1. `Stop prompting`
2. `End session`
3. `Don't ask anymore`
4. `Close conversation`

Do not infer session end from similar wording.
Do not treat satisfaction confirmations (for example `Satisfied`, `Looks good`, `LGTM`, `Thanks`) as stop phrases.
After a user confirms satisfaction, continue prompting until one of the exact stop phrases is used.

## Skipped command handling

If a user skips a requested command/script:

1. Ask why it was skipped.
2. Ask whether to continue with alternatives or stop.

## Prompt quality requirements

- Prompts MUST be short, specific, and decision-oriented.
- Include predefined options when possible.
- Avoid asking for secrets or credentials.

## Empty response and timeout policy

- If a required prompt times out or the user response is empty, you MUST re-prompt indefinitely.
- You MUST NOT fall back to plain-text completion when the built-in questions tool returns an empty response or error — re-prompt with a shorter, option-driven prompt.
- Re-prompts SHOULD be shorter and include predefined options when practical.
- You MUST NOT proceed with assumptions while required user input is still missing.

## Prompt-loop task tracking

- Use the TodoWrite tool to maintain a persistent prompt-loop reminder todo throughout the entire session.
- At the start of every task, create or keep a todo item titled "Interactively Prompt user after [current task]" with status `pending`.
- After each task completes and the satisfaction prompt is sent, update this todo to `in_progress` to signal a response is awaited.
- When the user responds without a stop phrase, reset the prompt todo back to `pending` for the next task cycle — never mark it `completed` prematurely.
- Continue this cycle, keeping the prompt reminder todo always active, for every task in the session.
- Only when the user sends one of the exact stop phrases:
  1. Add a todo "Final satisfaction check" with status `completed`.
  2. Add a todo "Stop prompting — session ended" with status `completed`.
  3. Mark the active prompt-loop todo as `completed`.
- This ensures the prompt obligation is always visible in the todo list and cannot be accidentally dropped between tasks.
