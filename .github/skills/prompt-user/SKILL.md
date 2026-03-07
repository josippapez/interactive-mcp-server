---
name: prompt-user
description: Interactive prompts to request confirmations, choices, and configuration from users during any work.
---

# prompt-user

Use this skill whenever user interaction is required. It operationalizes `.github/instructions/user-interaction.instructions.md`.

## Hard rules

1. Use only `request_user_input` for standard prompts.
2. Do not use built-in `askQuestions`.
3. If interactive-mcp tools are unavailable in runtime, use built-in ask-question tooling only as a temporary fallback.
4. Before any coding task, ask at least one scope/confirmation prompt.
5. Before final handoff, ask exactly:
   `Are you satisfied with this result, or would you like any changes?`
6. Continue prompting until user explicitly says one of:
   - `Stop prompting`
   - `End session`
   - `Don't ask anymore`

## Required trigger cases

- Requirement ambiguity.
- Competing implementation options.
- User asks a question that needs preference selection.
- Conflicting user instructions.
- User skipped a requested command/script.
- And any other situation described in the [../../instructions/user-interaction.instructions.md](../../.github/instructions/user-interaction.instructions.md) file.

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
