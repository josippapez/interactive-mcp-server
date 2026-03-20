---
name: prompt-user
description: Interactive prompts to request confirmations, choices, and configuration from users during any work.
---

# prompt-user

Use this skill whenever user interaction is required. It operationalizes `.github/instructions/user-interaction.instructions.md`.

## Hard rules

1. Use only `request_user_input` for standard prompts.
2. Do not use built-in `askQuestions`.
3. Before any coding task, ask at least one scope/confirmation prompt.
4. After final handoff, ask exactly:
   `Are you satisfied with this result, or would you like any changes?`
5. Maintain a persistent prompt-loop todo via TodoWrite for every task in the session — update it at each prompt trigger and only close it on an exact stop phrase (see [user-interaction.instructions.md](../../instructions/user-interaction.instructions.md#prompt-loop-task-tracking)).
6. Continue prompting until user explicitly says one of:
   - `Stop prompting`
   - `End session`
   - `Don't ask anymore`
   - `Close conversation`

## Required trigger cases

- Requirement ambiguity.
- Competing implementation options.
- User asks a question that needs preference selection.
- Conflicting user instructions.
- User skipped a requested command/script.
- After system-notification-driven outputs.
- Any other situation described in [../../instructions/user-interaction.instructions.md](../../instructions/user-interaction.instructions.md).

## Tool failure fallback

- If `request_user_input` fails, retry it once.
- If it fails again, fall back to `ask_user`.
- If all prompt tools fail, keep retrying — plain-text prompts are never an acceptable fallback.

## Prompt quality standard

- Keep prompts concise and action-oriented.
- Include `predefinedOptions` whenever practical.
- State why input is needed when choices have tradeoffs.

## Advanced flow support

- For multi-step configuration (2+ related inputs), you MAY use intensive chat flow tools.
- Intensive chat mapping:
  - `start_intensive_chat`
  - `ask_intensive_chat`
  - `stop_intensive_chat`

## Timeout handling

- If a prompt times out or receives an empty response, re-ask with shorter wording and clearer options.
- Continue re-prompting indefinitely until the user provides a non-empty response or an explicit stop phrase.
- Do not silently continue while required user input is missing.

## Forbidden prompt content

- Never ask for secrets (tokens, passwords, private keys).
- Do not ask for unnecessary personal data.

## Mapping

- Tool: `request_user_input({ projectName, message, predefinedOptions })`
