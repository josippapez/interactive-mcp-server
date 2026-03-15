---
name: agent-orchestration
description: Route tasks to the repository's starter custom agents based on task type and scope. Main agent acts as orchestrator and user-interaction loop owner throughout.
---

# agent-orchestration

Use this skill to decide when the main agent should delegate to a custom agent under `.github/agents`.

## Main agent role

The main agent is **always the orchestrator and user-interaction loop owner**. This means:

1. The main agent uses `prompt-user` skill (via `request_user_input`) to communicate with the user before, during, and after delegation — custom agents never talk to the user directly.
2. Before delegating, the main agent must confirm scope/approach with the user if there is any ambiguity (see `prompt-user` skill).
3. While a delegated agent works, the main agent may surface progress or intermediate questions to the user if the agent's output reveals ambiguity or a blocking decision.
4. After delegation, the main agent reviews, validates, and presents results to the user — then runs the mandatory satisfaction check from the `prompt-user` skill.

## Triggers

- `tooling-work`: MCP tool schema/capability updates, tool registration, CLI option behavior.
- `terminal-ui-work`: OpenTUI-based prompt UX, keyboard interaction, and terminal display flows.
- `lifecycle-work`: detached process behavior, heartbeat monitoring, temp-file IPC, cleanup reliability.
- `docs-sync`: docs updates caused by code/workflow behavior changes.
- `mixed-work`: request contains independent subtasks that map to different specialists.

## Agent mapping

- `interactive-mcp-tooling-specialist` for MCP tool definitions, capabilities, and registration tasks.
- `ink-terminal-ui-specialist` for OpenTUI/React terminal UI and prompt interaction work.
- `session-process-reliability-specialist` for process lifecycle and IPC reliability tasks.
- `docs-maintainer` for documentation synchronization tasks.

## Decision rules

1. **Single domain**: delegate to the one matching specialist. Do not implement it yourself.
2. **Mixed domains**: split into independent subtasks. Delegate each to its matching agent. Parallelize when subtasks do not depend on each other.
3. **No mapping matches**: fall back to normal main-agent workflow. Explicitly state why no specialist was used.
4. **Trivial change** (e.g. 1-line fix that takes under 30 seconds): the main agent may execute it directly; delegation overhead is not justified for trivial edits.
5. **Anti-recursion**: do not re-delegate the same unresolved objective more than one retry cycle.
6. **Anti-stall fallback**: if delegation stalls (timeouts, no meaningful progress, or repeated partial outputs), stop delegating and execute directly.
7. **Large-task decomposition**: break large requests into bounded subtasks with explicit completion criteria before delegation.

## Delegation prompt requirements

Every handoff prompt to a custom agent MUST include:

- **Objective**: one-sentence goal.
- **Scope**: files/projects/directories in scope.
- **Constraints**: files to avoid, ordering requirements, existing decisions to honour.
- **Validation expected**: what the agent must run/verify before reporting back (lint, build, tests, Trivy, etc.).
- **Handoff format**: what structured output is expected (e.g. findings table, diff summary, test results).

## After delegation

1. Read the agent's output fully before acting.
2. Run any additional verifications the agent did not cover (e.g. `docker compose up`, `curl /health`).
3. If the output reveals a new ambiguity or a blocking decision, surface it to the user via `prompt-user` skill **before** proceeding.
4. If the agent reported failure, retry once with a refined prompt. If it fails again, take over and execute directly, noting why.
5. If the retry still lacks meaningful progress, do not delegate again for that same objective; execute directly.
6. Own the final handoff quality: present a concise summary to the user, then run the mandatory satisfaction check.

## Best practices

- Include concrete scope in handoff prompts — vague prompts produce vague results.
- Never skip the post-delegation user satisfaction check (see `prompt-user` skill).
- When parallel delegation is used, collect all results before presenting to the user.
