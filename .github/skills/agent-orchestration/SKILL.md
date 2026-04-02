---
name: agent-orchestration
description: Route tasks to the repository's starter custom agents based on task type and scope. Main agent acts as orchestrator and prompting loop owner throughout.
---

# agent-orchestration

Use this skill to decide when and how to delegate to custom agents under
`.github/agents`.

## Core rules

1. The main agent MUST remain the orchestrator and prompt-loop owner; custom
   agents never talk to the user directly.
2. For mapped domains, the main agent MUST delegate unless the change is truly
   trivial.
3. Custom-agent launches MUST set an explicit high-tier reasoning model by
   default (`gpt-5.3-codex`, `claude-sonnet-4.6`, or `claude-opus-4.6`).
4. Fast/cheap models (`*-mini`, `*-haiku`) MAY be used only when the user
   explicitly prefers speed/cost over depth.
5. Delegation prompts MUST include a full context pack in one message:
   objective, scope, constraints, validation commands, and handoff format.
6. For empty/partial output on the same unresolved objective, the main agent
   MUST follow up with the same agent first (for example `read_agent` /
   `write_agent`) before launching a new agent.
7. After follow-up, the main agent MAY relaunch at most one new agent for that
   same unresolved objective.
8. The main agent MUST NOT create recursive new-agent spawning loops for the
   same unresolved objective.
9. If no meaningful progress remains after allowed attempts, the main agent
   MUST stop delegating, execute directly, validate, and report why.

## Context forwarding

Sub-agents run in separate sessions and do NOT inherit the main agent's CLI
extensions (`docs-recommender`, `test-reminder`, `prompt-loop`). Therefore:

1. The main agent MUST include any doc paths received via `docs-recommender`
   `additionalContext` in the delegation prompt's context section.
2. The main agent MUST include `npx nx test <project>` commands received via
   `test-reminder` context in the delegation prompt's validation commands
   section.

## Agent mapping

- `hcp-frontend-specialist` → frontend implementation/refactors.
- `nx-test-specialist` → test creation/refactoring.
- `docs-maintainer` → docs synchronization.
- `fe-guardrails-auditor` → FE guardrails remediation.
- `wcag-a11y-aa-specialist` → WCAG 2.2 A/AA audits/fixes.
- `figma-layout-token-analyst` → Figma analysis and token mapping.
- `dockerfile-specialist` → Dockerfile hardening and verification.
- `self-improve-specialist` → behavior/workflow changes (skills, instructions, docs).

## References

- docs/guides/agent-files.md#custom-agent-orchestration-starter-set
- .github/skills/prompt-user/SKILL.md
- .github/instructions/interactive-prompt-loop.instructions.md
- .github/instructions/agent-orchestration.instructions.md
- .github/agents/hcp-frontend-specialist.agent.md
- .github/agents/nx-test-specialist.agent.md
- .github/agents/docs-maintainer.agent.md
- .github/agents/fe-guardrails-auditor.agent.md
- .github/agents/wcag-a11y-aa-specialist.agent.md
- .github/agents/figma-layout-token-analyst.agent.md
- .github/agents/dockerfile-specialist.agent.md
- .github/agents/self-improve-specialist.agent.md
