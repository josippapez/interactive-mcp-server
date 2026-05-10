/**
 * Built-in skill and instruction templates that are seeded on first app launch.
 *
 * Seeding behaviour: `seedBuiltinTemplates` (database.ts) inserts an entry only
 * if no row with the same `name` already exists. It NEVER overwrites user edits.
 * To restore an edited entry to the bundled defaults, the user explicitly calls
 * `resetBuiltinTemplates`.
 *
 * Wording note: these templates target ANY agent harness. They reference the
 * "built-in questions tool" generically — i.e. whichever question/ask tool the
 * harness exposes (OpenCode `question`, Claude Code `AskUserQuestion`, etc.) —
 * rather than naming a specific MCP tool. Harness-specific instructions belong
 * in repository AGENTS.md / instructions files, not in seed data.
 */

export interface BuiltinTemplate {
  name: string;
  type: 'skill' | 'instruction';
  category: string;
  description: string;
  content: string;
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    name: 'agent-orchestration',
    type: 'skill',
    category: 'Workflow',
    description:
      'Route tasks to specialized agents based on task type and scope. Main agent acts as orchestrator and prompt-loop owner throughout.',
    content: `# agent-orchestration

Use this skill to decide when and how to delegate to specialized agents.

## Core principles

1. The main agent remains the orchestrator and prompt-loop owner; sub-agents never talk to the user directly.
2. For mapped domains, delegate unless the change is truly trivial (~30 seconds).
3. Delegation prompts include a full context pack in one message: objective, scope, constraints, validation, handoff format.
4. After empty/partial output, follow up with the same agent before launching a new one.
5. If no meaningful progress after one retry, stop delegating, execute directly, and report why.

## When to delegate

Delegate when a task clearly maps to a specialized domain:

- Frontend implementation -> frontend specialist
- Test creation/refactoring -> testing specialist
- Documentation sync -> docs maintainer
- Accessibility audits -> a11y specialist
- Infrastructure/DevOps -> infra specialist
- API/backend changes -> backend specialist

Trivial single-line fixes may be done directly. State why no specialist was used.

## Execution rules

1. Single domain -> delegate to one matching specialist.
2. Mixed domains -> split into independent subtasks. Parallelize only when subtasks share no state, output dependencies, or files.
3. No match -> fall back to main-agent workflow and explain why.
4. Anti-recursion -> do not re-delegate the same unresolved objective more than once.
5. Anti-stall -> if delegation stalls (timeouts, no progress), execute directly and report why.
6. Large tasks -> decompose into bounded subtasks with explicit completion criteria before delegation.

## Delegation prompt template

\`\`\`
Objective: [one-sentence goal]

Scope: [files, projects, or directories]

Constraints:
- [files to avoid]
- [prior decisions to honor]
- [ordering requirements]

Validation expected: [what the agent must run/verify]

Handoff format: [structured output expected]
\`\`\`

## After delegation

1. Read the agent's full output.
2. Run any verifications the agent did not cover.
3. If output reveals new ambiguity, surface it via the built-in questions tool before proceeding.
4. If the agent reports failure, retry once with a refined prompt. If it fails again, execute directly.
5. Present a concise summary and run the satisfaction check.`,
  },
  {
    name: 'agent-orchestration-policy',
    type: 'instruction',
    category: 'Workflow',
    description:
      'Policy for delegating work to specialized agents. Main agent is the orchestrator and user-interaction loop owner throughout.',
    content: `# Agent Orchestration Policy

## Main agent role

The main agent is the orchestrator and user-interaction loop owner. Specialized agents never interact with the user directly.

Responsibilities at all times:

- Use the built-in questions tool to communicate with the user before, during, and after delegation.
- Confirm scope or approach before delegating if there is any ambiguity.
- After delegation, review all outputs, run additional verifications if needed, and present a concise result.
- Run the satisfaction check before closing any task.

## When to delegate

Delegate when a task clearly maps to a specialized domain:

| Domain | Specialist |
|--------|------------|
| Frontend UI/components | Frontend specialist |
| Unit/integration tests | Testing specialist |
| Documentation updates | Docs maintainer |
| Accessibility (WCAG) | A11y specialist |
| Infrastructure/Docker | DevOps specialist |
| API/database changes | Backend specialist |
| Security hardening | Security specialist |

Trivial changes (single-line fix, ~30s) may be done directly; state why no specialist was used.

## Execution rules

1. Single domain -> delegate to one matching specialist.
2. Mixed domains -> split into independent subtasks. Parallelize only when subtasks share no state, no output dependencies, and no overlapping files.
3. No match -> normal main-agent workflow. Explain why.
4. Anti-recursion -> do not re-delegate the same unresolved objective more than once.
5. Anti-stall -> if delegation stalls (timeouts, no progress, repeated partial output), execute directly and report why.
6. Large tasks -> decompose into bounded subtasks with explicit completion criteria.

## Every delegation prompt MUST include

- Objective (one sentence).
- Scope (files, projects, directories).
- Constraints (files to avoid, prior decisions, ordering).
- Validation expected (lint, build, tests, etc.).
- Handoff format (findings table, diff summary, etc.).

## After delegation

1. Read the full output.
2. Run any verifications the agent did not cover.
3. If output reveals ambiguity or a blocking decision, ask via the built-in questions tool before proceeding.
4. If the agent reports failure, retry once with a refined prompt. If it fails again, execute directly.
5. If retried handoff still lacks progress, do not delegate again for the same objective.
6. Present a concise summary and run the satisfaction check.`,
  },
  {
    name: 'prompt-user',
    type: 'skill',
    category: 'Workflow',
    description:
      'Run user-facing prompt loops with the built-in questions tool for scope confirmation, decision collection, and post-delivery satisfaction checks.',
    content: `# prompt-user

Use this skill for any user-facing prompt workflow.

## Required behavior

1. Use the built-in questions tool (the harness-provided question/ask tool) for prompts.
2. Before starting each newly requested task, ask at least one scope/confirmation prompt.
3. After any task delivery, ask exactly:
   \`Are you satisfied with this result, or would you like any changes?\`
4. Stop prompting only on these exact phrases:
   - \`Stop prompting\`
   - \`End session\`
   - \`Don't ask anymore\`
   - \`Close conversation\`
5. Any non-stop outcome continues the loop and triggers re-prompting:
   - non-stop user replies (acknowledgements, new task requests)
   - prompt timeout or empty response
   - prompt decline/cancel/dismiss
   - prompt tool failure
6. On tool failure or timeout, retry the built-in questions tool. Do not fall back to plain text.
7. Plain-text prompts are not an acceptable substitute when a prompt trigger applies.
8. If implementation is still pending (only a report/diff was delivered), ask whether to implement next.
9. Maintain one persistent prompt-loop todo titled \`Interactively Prompt user after [current task]\`; keep it active across cycles and complete it only on an exact stop phrase.

## Trigger cases

Prompt at: task start, ambiguity, competing options, conflicts, skipped commands, post-notification outputs, and final handoff.

## Prompt quality

- Concise, action-oriented, decision-focused.
- Include predefined options when practical.
- Never ask for secrets or unnecessary personal data.

## Prompt-loop todo pattern

- At task start: keep \`Interactively Prompt user after [current task]\` as \`pending\`.
- After sending the satisfaction prompt: set it to \`in_progress\`.
- On any non-stop reply: reset to \`pending\` for the next cycle.
- On exact stop phrase only: mark it \`completed\`.`,
  },
  {
    name: 'interactive-prompt-loop',
    type: 'instruction',
    category: 'Workflow',
    description:
      'Deterministic prompt-loop policy with stop phrases, satisfaction check, and timeout handling.',
    content: `# Interactive Prompt-Loop Policy

A concise prompt-loop policy. Use the built-in questions tool (the harness-provided question/ask tool) for all prompts.

## Stop phrases (exact match only)

- \`Stop prompting\`
- \`End session\`
- \`Don't ask anymore\`
- \`Close conversation\`

## Required rules

1. Before starting each newly requested task, ask a scope/confirmation prompt via the built-in questions tool.
2. After each task delivery, ask exactly:
   \`Are you satisfied with this result, or would you like any changes?\`
3. Maintain one active todo titled \`Interactively Prompt user after [current task]\`.
4. Keep the todo active across cycles (\`pending\` -> \`in_progress\` -> \`pending\`) until an exact stop phrase.
5. Mark the todo completed only when an exact stop phrase is received.
6. If a prompt times out or returns empty, re-prompt with a shorter, option-driven question.
7. If the prompt tool fails, retry the built-in questions tool. Do not fall back to plain-text completion.
8. Do not use plain-text prompting when a prompt trigger applies.`,
  },
  {
    name: 'llm-coding-guidelines',
    type: 'instruction',
    category: 'Workflow',
    description:
      'Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.',
    content: `# LLM Coding Guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

Tradeoff: these guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think before coding

Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity first

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical changes

Touch only what you must. Clean up only your own mess.

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

## 4. Goal-driven execution

Define success criteria. Loop until verified.

Transform tasks into verifiable goals:
- "Add validation" -> "Write tests for invalid inputs, then make them pass."
- "Fix the bug" -> "Write a test that reproduces it, then make it pass."
- "Refactor X" -> "Ensure tests pass before and after."

For multi-step tasks, state a brief plan:

\`\`\`
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
\`\`\`

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

These guidelines are working if: fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.`,
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
