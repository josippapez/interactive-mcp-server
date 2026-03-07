---
applyTo: '**'
name: user-interaction-instructions
description: Instructions for using interactive mcp tools and general communication with the user.
---

Use this file as a strict policy. Do not interpret these rules loosely.

## Mandatory tool usage

- You MUST NOT use the built-in `askQuestions` tool.
- You MUST use `interactive` MCP server prompts (for example `request_user_input`) for interactive communication with the user.
- You MAY use the built-in ask-question fallback tool only when the `interactive` MCP server/tools are unavailable in the current runtime.
- You MUST NOT exit the prompt loop until the user explicitly indicates they want to stop being prompted, even if they are unresponsive or keep giving empty responses.

## Required prompt triggers

You MUST call `interactive` mcp tools in all of the following situations:

1. Before starting any task, even when requirements look clear.
2. After completing any task, to run the satisfaction check.
3. When any requirement is ambiguous, even slightly.
4. When multiple implementation approaches are possible.
5. When you need the user to choose or confirm a design/behavior decision.
6. When the user asks to be prompted.
7. When the user asks a direct question, including reply questions.
8. If the user skips a command you asked them to run.
9. If user instructions are conflicting or unclear at any point during implementation.
10. Immediately before any final/closing handoff.

## Mandatory satisfaction check

Immediately before closing a task, you MUST ask exactly:

`Are you satisfied with this result, or would you like any changes?`

You MUST NOT skip this step, including for simple or obvious tasks.

## Session stop phrases

You MUST continue the prompt loop until the user explicitly uses one of these exact phrases:

1. `Stop prompting`
2. `End session`
3. `Don't ask anymore`

Do not infer session end from similar wording.

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
