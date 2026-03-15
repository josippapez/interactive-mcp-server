---
applyTo: '**'
name: agent-orchestration-instructions
description: Delegate qualifying work to starter custom agents using the repository orchestration skill.
---

---

applyTo: 'apps/**,libs/**,tools/**,docs/**,.github/\*\*'
name: agent-orchestration-instructions
description: Delegate qualifying work to starter custom agents. Main agent is the orchestrator and user-interaction loop owner throughout.

---

## Main agent role

The main agent is the **orchestrator and user-interaction loop owner**. Custom agents never interact with the user directly.

Responsibilities of the main agent at all times:

- Use `prompt-user` skill / `request_user_input` to communicate with the user before, during, and after delegation.
- Confirm scope or approach with the user before delegating if there is **any ambiguity**.
- After delegation completes, review all outputs, run additional verifications if needed, and present a concise result to the user.
- Run the mandatory satisfaction check (`Are you satisfied with this result, or would you like any changes?`) before closing any task — even trivial ones.

## When to delegate

When a task clearly maps to one of the custom agents below, the main agent MUST delegate it to that agent instead of doing it itself.

**Exception**: trivial changes (a single-line fix or rename taking under ~30 seconds) may be done directly by the main agent. State why no specialist was used.

# Delegation map:

- MCP tool schema/capability/registration tasks -> `interactive-mcp-tooling-specialist`
- OpenTUI/terminal prompt UI implementation or refactor tasks -> `ink-terminal-ui-specialist`
- Session lifecycle/process reliability and IPC tasks -> `session-process-reliability-specialist`
- Documentation synchronization tasks -> `docs-maintainer`

## Execution rules

1. **Single domain**: delegate to the one matching specialist.
2. **Mixed domains**: split into independent subtasks and delegate each to its agent. Parallelize only when tasks have no shared state, no output dependencies between them, and no overlapping file changes.
3. **No match**: fall back to normal main-agent workflow and explain why no specialist was used.
4. **Anti-recursion**: do not recursively re-delegate the same unresolved objective more than one retry cycle.
5. **Anti-stall fallback**: if delegation stalls (timeouts, no meaningful file/output progress, or repeated partial output), stop delegating, execute directly, and report why.
6. **Bounded delegation for large tasks**: decompose large requests into smaller bounded subtasks with explicit completion criteria before delegation.

## What every delegation prompt MUST include

- **Objective**: one-sentence goal.
- **Scope**: files, projects, or directories in scope.
- **Constraints**: files to avoid, prior decisions to honour, ordering requirements.
- **Validation expected**: what the agent must run/verify (e.g. lint, build, tests, Trivy scan).
- **Handoff format**: the structured output the agent must return (e.g. findings table, diff summary).

## After delegation

1. Read the agent's full output.
2. Run any verifications the agent did not cover.
3. If the output reveals a new ambiguity or a blocking decision, surface it to the user via `prompt-user` **before** proceeding.
4. If the agent reports failure, retry once with a refined prompt. If it fails again, execute directly and note why.
5. If the retried handoff still lacks meaningful progress, do not delegate again for the same objective; execute directly.
6. Present a concise summary to the user and run the mandatory satisfaction check.

Use `agent-orchestration` skill for the full routing workflow and agent capability details.
