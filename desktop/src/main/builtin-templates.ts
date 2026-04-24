/**
 * Built-in skill and instruction templates that are seeded on first app launch.
 *
 * These templates provide useful defaults based on the actual content from
 * the repository's .github/skills/ and .github/instructions/ directories.
 */

export interface BuiltinTemplate {
  name: string;
  type: 'skill' | 'instruction';
  category: string;
  description: string;
  content: string;
}

/**
 * Built-in templates based on repository content.
 * These are seeded on first launch and can be restored if deleted.
 */
export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    name: 'agent-orchestration',
    type: 'skill',
    category: 'Workflow',
    description:
      'Route tasks to specialized agents based on task type and scope. Main agent acts as orchestrator and prompting loop owner throughout.',
    content: `# agent-orchestration

Use this skill to decide when and how to delegate to specialized agents.

## Core principles

1. The main agent MUST remain the orchestrator and prompt-loop owner; sub-agents never talk to the user directly.
2. For mapped domains, the main agent MUST delegate unless the change is truly trivial (~30 seconds or less).
3. Delegation prompts MUST include a full context pack in one message: objective, scope, constraints, validation commands, and handoff format.
4. After empty/partial output, follow up with the same agent first before launching a new one.
5. If no meaningful progress after allowed attempts, stop delegating, execute directly, and report why.

## When to delegate

Delegate when a task clearly maps to a specialized domain:

- **Frontend implementation** → frontend specialist
- **Test creation/refactoring** → testing specialist  
- **Documentation sync** → docs maintainer
- **Accessibility audits** → a11y specialist
- **Infrastructure/DevOps** → infrastructure specialist
- **API/Backend changes** → backend specialist

**Exception**: trivial single-line fixes may be done directly. State why no specialist was used.

## Execution rules

1. **Single domain**: delegate to one matching specialist.
2. **Mixed domains**: split into independent subtasks and delegate each. Parallelize only when tasks have no shared state or output dependencies.
3. **No match**: fall back to main-agent workflow and explain why.
4. **Anti-recursion**: do not recursively re-delegate the same unresolved objective more than once.
5. **Anti-stall fallback**: if delegation stalls (timeouts, no progress), execute directly and report why.
6. **Large tasks**: decompose into smaller bounded subtasks with explicit completion criteria before delegation.

## Delegation prompt template

Every delegation MUST include:

\`\`\`
**Objective**: [one-sentence goal]

**Scope**: [files, projects, or directories in scope]

**Constraints**: 
- [files to avoid]
- [prior decisions to honor]
- [ordering requirements]

**Validation expected**: [what the agent must run/verify]

**Handoff format**: [structured output expected]
\`\`\`

## After delegation

1. Read the agent's full output.
2. Run any verifications the agent did not cover.
3. If output reveals new ambiguity, surface it to the user before proceeding.
4. If agent reports failure, retry once with refined prompt. If it fails again, execute directly.
5. Present a concise summary to the user and run the mandatory satisfaction check.`,
  },
  {
    name: 'agent-orchestration-policy',
    type: 'instruction',
    category: 'Workflow',
    description:
      'Policy for delegating work to specialized agents. Main agent is the orchestrator and user-interaction loop owner throughout.',
    content: `# Agent Orchestration Policy

## Main agent role

The main agent is the **orchestrator and user-interaction loop owner**. Specialized agents never interact with the user directly.

### Responsibilities at all times

- Use \`request_user_input\` to communicate with the user before, during, and after delegation.
- Confirm scope or approach with the user before delegating if there is **any ambiguity**.
- After delegation completes, review all outputs, run additional verifications if needed, and present a concise result to the user.
- Run the mandatory satisfaction check before closing any task — even trivial ones.

## When to delegate

When a task clearly maps to a specialized domain, the main agent MUST delegate instead of doing it itself.

### Common delegation domains

| Domain | Specialist Type |
|--------|-----------------|
| Frontend UI/components | Frontend specialist |
| Unit/integration tests | Testing specialist |
| Documentation updates | Docs maintainer |
| Accessibility (WCAG) | A11y specialist |
| Infrastructure/Docker | DevOps specialist |
| API/database changes | Backend specialist |
| Security hardening | Security specialist |

**Exception**: trivial changes (single-line fix, ~30 seconds) may be done directly. State why no specialist was used.

## Execution rules

1. **Single domain**: delegate to the one matching specialist.
2. **Mixed domains**: split into independent subtasks and delegate each to its agent. Parallelize only when tasks have no shared state, no output dependencies, and no overlapping file changes.
3. **No match**: fall back to normal main-agent workflow and explain why no specialist was used.
4. **Anti-recursion**: do not recursively re-delegate the same unresolved objective more than one retry cycle.
5. **Anti-stall fallback**: if delegation stalls (timeouts, no meaningful file/output progress, or repeated partial output), stop delegating, execute directly, and report why.
6. **Bounded delegation for large tasks**: decompose large requests into smaller bounded subtasks with explicit completion criteria before delegation.

## What every delegation prompt MUST include

- **Objective**: one-sentence goal.
- **Scope**: files, projects, or directories in scope.
- **Constraints**: files to avoid, prior decisions to honor, ordering requirements.
- **Validation expected**: what the agent must run/verify (e.g., lint, build, tests).
- **Handoff format**: the structured output the agent must return (e.g., findings table, diff summary).

## After delegation

1. Read the agent's full output.
2. Run any verifications the agent did not cover.
3. If the output reveals a new ambiguity or a blocking decision, surface it to the user via \`request_user_input\` **before** proceeding.
4. If the agent reports failure, retry once with a refined prompt. If it fails again, execute directly and note why.
5. If the retried handoff still lacks meaningful progress, do not delegate again for the same objective; execute directly.
6. Present a concise summary to the user and run the mandatory satisfaction check.`,
  },
  {
    name: 'prompt-user',
    type: 'skill',
    category: 'Workflow',
    description:
      'Run user-facing prompt loops with request_user_input for scope confirmation, decision collection, and mandatory post-delivery satisfaction checks.',
    content: `# prompt-user

Use this skill for any user-facing prompt workflow.

## Required behavior

1. Use \`request_user_input\` for prompts.
2. Do not use built-in \`askQuestions\`.
3. Before starting each newly requested task in an active session, ask at least one scope/confirmation prompt.
4. After any task output/delivery, ask exactly:
   \`Are you satisfied with this result, or would you like any changes?\`
5. Prompting MUST stop only on these exact phrases:
   - \`Stop prompting\`
   - \`End session\`
   - \`Don't ask anymore\`
   - \`Close conversation\`
6. Any non-stop outcome MUST continue the active loop and trigger re-prompting:
   - non-stop user replies (including acknowledgements and new task requests)
   - prompt timeout or empty response
   - prompt decline/cancel/dismiss
   - prompt tool failure
7. Tool-failure fallback: retry \`request_user_input\` indefinitely; MUST NOT fall back to plain text or any non-interactive-MCP tool.
8. Interactive timeout hardening: when interactive MCP calls fail with timeout signals (for example \`request timed out\`, \`-32001\`, or equivalent), you MUST keep prompting indefinitely with interactive prompt tools and MUST NOT complete via plain text.
9. Plain-text completion fallback is forbidden for interactive timeout/tool failures.
10. Plain-text prompts are never an acceptable fallback.
11. If implementation is still pending (report/diff checkpoint only), ask whether to implement next and keep prompting.
12. After system-notification-driven outputs, include the mandatory satisfaction prompt again.
13. Maintain one persistent prompt-loop todo titled \`Interactively Prompt user after [current task]\`; keep it active across task cycles and only complete it on an exact stop phrase.

## Trigger cases

- Task start, ambiguity, competing options, conflicts, skipped commands, and post-notification outputs.

## Prompt quality

- Keep prompts concise and action-oriented.
- Include predefined options whenever practical.
- Never ask for secrets or unnecessary personal data.

## Prompt-loop todo pattern

- At task start: create/keep \`Interactively Prompt user after [current task]\` as \`pending\`.
- After sending the satisfaction prompt: set it to \`in_progress\`.
- On any non-stop user reply: reset it to \`pending\` for the next task.
- On exact stop phrase only: mark it \`completed\`.`,
  },
  {
    name: 'interactive-prompt-loop',
    type: 'instruction',
    category: 'Workflow',
    description:
      'Deterministic interactive prompt-loop policy with stop phrases and timeout handling.',
    content: `# Interactive Prompt-Loop Policy

This is a concise summary of the prompt-loop policy.

## Stop phrases (exact match only)

- \`Stop prompting\`
- \`End session\`
- \`Don't ask anymore\`
- \`Close conversation\`

## Required rules

1. Before starting each newly requested task in an active session, you MUST ask a scope/confirmation prompt via interactive MCP.
2. After each task delivery, you MUST ask exactly:
   \`Are you satisfied with this result, or would you like any changes?\`
3. You MUST maintain one active todo titled \`Interactively Prompt user after [current task]\`.
4. You MUST keep the todo active across cycles (\`pending\` -> \`in_progress\` -> \`pending\`) until an exact stop phrase.
5. You MUST mark the todo completed only when an exact stop phrase is received.
6. If a prompt times out or response is empty, you MUST re-prompt.
7. If interactive MCP prompting returns timeout failures (for example \`request timed out\`, \`-32001\`, or equivalent timeout errors), you MUST keep prompting indefinitely with interactive prompt tools and MUST NOT fall back to plain-text completion.
8. You MUST NOT use plain-text prompting when an interactive prompt trigger applies.`,
  },
  {
    name: 'user-interaction',
    type: 'instruction',
    category: 'Workflow',
    description:
      'Instructions for interacting, prompting, and asking questions using interactive MCP tools.',
    content: `# User Interaction Instructions

Use this file as a strict policy. Do not interpret these rules loosely.

## Mandatory tool usage

- You MUST NOT use the built-in \`askQuestions\` tool.
- You MUST use \`interactive\` MCP server prompts (for example \`request_user_input\`) for interactive communication with the user.
- You MUST NOT exit the prompt loop until the user explicitly indicates they want to stop being prompted, even if they are unresponsive or keep giving empty responses.
- You MUST NOT send plain-text-only user-facing replies when a prompt trigger applies; use an \`interactive\` prompt in that same response.

## System-notification clarification

- System notifications (for example command completion/background updates) are **not** a valid reason to skip prompting.
- If you send a user-facing reply after processing a system notification, all normal prompt-trigger rules still apply.
- If that reply is a completion/handoff, you MUST run the mandatory satisfaction prompt via \`interactive\` in the same response.

## Required prompt triggers

You MUST call \`interactive\` mcp tools in all of the following situations:

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

\`Are you satisfied with this result, or would you like any changes?\`

You MUST NOT skip this step, including for simple or obvious tasks. And you MUST NOT infer satisfaction as a session stopping condition. Always ask for explicit confirmation, and continue prompting until the user explicitly indicates they want to stop being prompted.

## Session stop phrases

You MUST continue the prompt loop until the user explicitly uses one of these exact phrases:

1. \`Stop prompting\`
2. \`End session\`
3. \`Don't ask anymore\`
4. \`Close conversation\`

Do not infer session end from similar wording.
Do not treat satisfaction confirmations (for example \`Satisfied\`, \`Looks good\`, \`LGTM\`, \`Thanks\`) as stop phrases.
After a user confirms satisfaction, continue prompting until one of the exact stop phrases is used.

## Empty response and timeout policy

- If a required prompt times out or the user response is empty, you MUST re-prompt indefinitely.
- If interactive MCP prompting returns timeout failures (for example \`request timed out\`, \`-32001\`, or equivalent timeout errors), you MUST keep prompting indefinitely with interactive prompt tools and MUST NOT fall back to plain-text completion.
- Re-prompts SHOULD be shorter and include predefined options when practical.
- You MUST NOT proceed with assumptions while required user input is still missing.`,
  },
  {
    name: 'llm-coding-guidelines',
    type: 'instruction',
    category: 'Workflow',
    description:
      'Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.',
    content: `Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" -> "Write tests for invalid inputs, then make them pass"
- "Fix the bug" -> "Write a test that reproduces it, then make it pass"
- "Refactor X" -> "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

\`\`\`
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
\`\`\`

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.`,
  },
];

/**
 * Returns the names of all built-in templates.
 */
export function getBuiltinTemplateNames(): string[] {
  return BUILTIN_TEMPLATES.map((t) => t.name);
}

/**
 * Checks if a given name is a built-in template.
 */
export function isBuiltinTemplate(name: string): boolean {
  return BUILTIN_TEMPLATES.some((t) => t.name === name);
}

/**
 * Gets a built-in template by name, or null if not found.
 */
export function getBuiltinTemplate(name: string): BuiltinTemplate | null {
  return BUILTIN_TEMPLATES.find((t) => t.name === name) ?? null;
}
