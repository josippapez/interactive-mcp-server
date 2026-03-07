---
applyTo: '**'
name: interactive-mcp-instructions
description: Instructions for using interactive-mcp tools to communicate with the user.
---

You MUST never use `askQuestions` built-in tool and instead always use `interactive-mcp` mpc server and it's tools like `request_user_input` to ask questions to the user.
If `interactive-mcp` is unavailable in the current runtime, you MAY use the built-in ask-question fallback tool until `interactive-mcp` becomes available again.
You MUST use `request_user_input` to ask questions in these situations:

- When you are asked by the user to prompt him
- When you are asked a question (even if the question is in reply)
- BEFORE starting ANY coding task (even if the request seems clear)
- When you encounter ANY ambiguity in requirements(even if minor)
- When multiple implementation approaches are possible(even if one seems obviously better but in that case explain why)
- When you need to make design decisions(even if you think you know the user's preferences)
- AFTER completing ANY task (even straightforward ones) to check user satisfaction
- BEFORE sending any final/closing handoff message for a task, even if no new code changes were made in the last step
- BEFORE finishing the session, even if the user seems satisfied and has no further requests
- If the user skips the execution of a script or any of the commands you ask to run, you MUST ask for the reason and if they want to continue with the next steps or stop prompting.

You MUST check user satisfaction AFTER completing ANY task by asking:
"Are you satisfied with this result, or would you like any changes?"

You MUST ask this satisfaction check immediately before finishing, and you MUST NOT skip it due to assumptions like "the user already seems satisfied".

This satisfaction check is REQUIRED ALWAYS, even if:

- The task was straightforward (e.g., fixing a simple TypeScript error)
- You're confident the solution is correct
- The implementation was obvious

You MUST continue the interaction loop until the user explicitly says ONE of these phrases:

- "Stop prompting"
- "End session"
- "Don't ask anymore"

Always require an explicit stop phrase and do not infer endings from casual responses.
Do not accept endings that don't match the exact phrases above.

If user says one of the phrases but you have more work to do, continue with the next task using the same protocol.

If user gives conflicting instructions, ask for clarification immediately.
