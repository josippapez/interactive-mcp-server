# Prompting Tool Selection

This guide owns the repository policy for choosing how agents ask users questions in this workspace.

## Default rule

- Agents MUST use the **built-in questions tool** (the harness-provided `question` / `ask_question` / equivalent) for all user-facing questions, confirmations, and decisions.
- Interactive MCP prompt tools (`request_user_input`, `ask_intensive_chat`, `start_intensive_chat`, `stop_intensive_chat`, `push_session_status`) are NOT part of this repository's prompt path and MUST NOT be used.
- Plain-text-only replies MUST NOT be used when a prompt trigger applies. Always route through the built-in questions tool.

## Why the built-in questions tool

- Reliable — no network/IPC dependency on an external MCP server.
- Always available — ships with the agent harness.
- Consistent UX — a single prompt path across every repo.

## Behavior requirements (unchanged policy wrapping the tool)

The prompt-loop policy is unchanged — only the underlying tool is swapped. When using the built-in questions tool:

- Keep prompts short, specific, and option-driven when the tool supports options.
- Preserve the mandatory satisfaction-check wording after each task delivery:
  `Are you satisfied with this result, or would you like any changes?`
- Continue the prompt loop until the user uses one of the exact stop phrases:
  - `Stop prompting`
  - `End session`
  - `Don't ask anymore`
  - `Close conversation`
- Do not treat satisfaction confirmations (`Satisfied`, `LGTM`, `Thanks`, etc.) as stop phrases.
- If the tool returns an empty response or a timeout, re-prompt.

## Non-goals

- This policy does not remove the desktop app's MCP tool _implementations_ — those still exist in `desktop/src/main/tools/` and power external agents connecting to the desktop app.
- This policy does not authorize plain-text prompting when a question-tool trigger applies.

## Files that should stay aligned with this guide

- `AGENTS.md` (root)
- `.github/instructions/user-interaction.instructions.md`
- `.github/instructions/interactive-prompt-loop.instructions.md`
- `.github/instructions/agent-orchestration.instructions.md`
- `.github/skills/prompt-user/SKILL.md`
- `.github/skills/agent-orchestration/SKILL.md`
- `.github/copilot-instructions.md`

## Historical note

Earlier versions of this guide allowed `interactive` MCP (`@rawwee/interactive-mcp` / `interactive-desktop`) as the default prompt path with the built-in questions tool as a fallback. That policy was reversed because the built-in tool proved more reliable for in-repo agent work. The MCP tool implementations remain intact for external consumers of the desktop app; only the in-repo agent guidance changed.
