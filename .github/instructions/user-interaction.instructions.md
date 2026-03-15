---
applyTo: '**'
name: user-interaction-instructions
description: Instructions for interacting, prompting general communication, and asking questions and providing suggestions to the user using interactive MCP tools.
---

Use this file as a strict policy. Do not interpret these rules loosely.

## Mandatory tool usage

- You MUST NOT use the built-in `askQuestions` tool.
- You MUST use `interactive` MCP server prompts (for example `request_user_input`) for interactive communication with the user.
- You MUST NOT exit the prompt loop until the user explicitly indicates they want to stop being prompted, even if they are unresponsive or keep giving empty responses.
- You MUST NOT send plain-text-only user-facing replies when a prompt trigger applies; use an `interactive` prompt in that same response.

## System-notification clarification

- System notifications (for example command completion/background updates) are **not** a valid reason to skip prompting.
- If you send a user-facing reply after processing a system notification, all normal prompt-trigger rules still apply.
- If that reply is a completion/handoff, you MUST run the mandatory satisfaction prompt via `interactive` in the same response.

## Required prompt triggers

You MUST call `interactive` mcp tools in all of the following situations:

1. Before any task, even when requirements look clear.
2. After any task, to run the satisfaction check.
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

## Mandatory satisfaction check

You MUST ask exactly:

`Are you satisfied with this result, or would you like any changes?`

You MUST NOT skip this step, including for simple or obvious tasks. And you MUST NOT infer satisfaction as a session stopping condition. Always ask for explicit confirmation, and continue prompting until the user explicitly indicates they want to stop being prompted.
You MUST NOT send satisfaction check prompts as plain text; they MUST be sent using an `interactive` prompt trigger.

## Follow-up continuity rule (anti-stop safeguard)

- If the user sends any follow-up request/question after a satisfaction prompt and does not use an exact stop phrase, the session is still active.
- You MUST treat that follow-up as an active session continuation: complete the requested work and continue the mandatory prompt loop.
- In every subsequent user-facing response where a prompt trigger applies, you MUST include the required `interactive` prompt in that same response.
- You MUST NOT send plain-text-only follow-up/completion replies when a prompt trigger applies.
- After each follow-up task completion, you MUST ask the mandatory satisfaction question again via `interactive` prompt.
- This applies even when the follow-up is only “explain”, “show diff”, or any brief clarification.

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
- Re-prompts SHOULD be shorter and include predefined options when practical.
- You MUST NOT proceed with assumptions while required user input is still missing.
