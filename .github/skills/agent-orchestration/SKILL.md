---
name: agent-orchestration
description: Route tasks to the repository's starter custom agents based on task type and scope.
---

# agent-orchestration

Use this skill to decide when the main agent should delegate to a custom agent under `.github/agents`.

## Triggers

- `tooling-work`: MCP tool schema/capability updates, tool registration, CLI option behavior.
- `terminal-ui-work`: OpenTUI-based prompt UX, keyboard interaction, and terminal display flows.
- `lifecycle-work`: detached process behavior, heartbeat monitoring, temp-file IPC, cleanup reliability.
- `docs-sync`: docs updates caused by code/workflow behavior changes.
- `mixed-work`: request contains independent subtasks that map to different specialists.

## Inputs

- `taskSummary` (required): User request in one or two sentences.
- `impactedAreas` (optional): `web`, `mobile`, `shared`, `tooling`, `docs`.
- `constraints` (optional): Validation scope, files to avoid, ordering requirements.

## Outputs

- `delegationPlan`: selected custom agent(s), rationale, and execution order.
- `handoffContext`: concise prompt context for each delegated agent.
- `validationPlan`: required checks to run before final handoff.

## Agent mapping

- `interactive-mcp-tooling-specialist` for MCP tool definitions, capabilities, and registration tasks.
- `ink-terminal-ui-specialist` for OpenTUI/React terminal UI and prompt interaction work.
- `session-process-reliability-specialist` for process lifecycle and IPC reliability tasks.
- `docs-maintainer` for documentation synchronization tasks.

## Best practices

- Delegate to one specialist by default; delegate in parallel only when subtasks are independent.
- Include concrete scope in handoff prompts: objective, files/projects, acceptance criteria, validations.
- After delegation, the main agent must verify critical changes and run relevant validations.
- If no mapping fits, fall back to normal workflow and state why delegation was not used.

## References

- .github/agents/interactive-mcp-tooling-specialist.agent.md
- .github/agents/ink-terminal-ui-specialist.agent.md
- .github/agents/session-process-reliability-specialist.agent.md
- .github/agents/docs-maintainer.agent.md
