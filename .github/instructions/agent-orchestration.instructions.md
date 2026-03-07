---
applyTo: '**'
name: agent-orchestration-instructions
description: Delegate qualifying work to starter custom agents using the repository orchestration skill.
---

When a task clearly matches one of the custom agent domains, the main agent MUST delegate using the matching custom agent workflow.

Delegation map:

- MCP tool schema/capability/registration tasks -> `interactive-mcp-tooling-specialist`
- OpenTUI/terminal prompt UI implementation or refactor tasks -> `ink-terminal-ui-specialist`
- Session lifecycle/process reliability and IPC tasks -> `session-process-reliability-specialist`
- Documentation synchronization tasks -> `docs-maintainer`

Execution rules:

1. For single-domain work, delegate to one matching specialist.
2. For mixed work, split independent subtasks and delegate in parallel where safe.
3. Provide clear delegation context: objective, scope, impacted files/projects, and validation expectations.
4. After delegated work completes, the main agent MUST review outputs, run relevant validations, and own final handoff quality.

Use `agent-orchestration` skill as the canonical routing workflow for this mapping.
