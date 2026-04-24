# Skills & Instructions Injection

## Overview

This document describes how DB-stored skills and instructions are delivered into OpenCode session context today.

The current implementation uses a minimal instruction delivery-mode model:

- **Skills** are always catalog entries.
- **Instructions in `always` mode** are injected inline.
- **Instructions in `catalog` mode** are exposed as catalog entries and fetched on demand.

This document reflects the code currently shipped in `desktop/src/main/tools/startup-context.ts`, `desktop/src/main/tools/skills-broadcast.ts`, and the related bootstrap paths. It does not describe speculative future modes.

---

## Storage Layer

All entries live in the `skills_and_instructions` SQLite table.

Fields relevant to delivery:

| Column          | Role                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `name`          | Unique lookup key for `manage_skills_and_instructions get`.                                           |
| `type`          | `skill` or `instruction`.                                                                             |
| `description`   | Always included in bootstrap catalog blocks.                                                          |
| `content`       | Inlined only for `always` instructions; otherwise fetched on demand.                                  |
| `enabled`       | Disabled rows are excluded from startup context.                                                      |
| `delivery_mode` | `always` or `catalog`; controls whether instruction content is inlined or exposed as a catalog entry. |
| `scope`         | `global` or `session-scoped`; controls whether the entry is included for a given session.             |

CRUD is exposed through `manage_skills_and_instructions`.

---

## Startup Context Model

`buildStartupContextMessage` produces a single `<system-reminder>` block with these sections:

1. Bootstrap header.
2. `<available_skills source="db">` for all included skills.
3. `<available_instructions source="db">` for included `catalog` instructions.
4. `<instructions source="db">` for included `always` instructions.
5. A trailing `get` hint when any catalog content is present.

Empty sections are omitted.

### Delivery Rules

| Entry kind              | Bootstrap delivery                       | Full content available immediately? |
| ----------------------- | ---------------------------------------- | ----------------------------------- |
| Skill                   | `<available_skills>` catalog entry       | No                                  |
| Instruction (`always`)  | `<instructions>` inline content          | Yes                                 |
| Instruction (`catalog`) | `<available_instructions>` catalog entry | No                                  |

### Example

```xml
<system-reminder>
Interactive MCP Desktop session bootstrap:
- Registered agent: Docs Agent
- Project: interactive-mcp-server
- Base directory: /Users/me/project

<available_skills source="db">
  <skill>
    <name>run-tests</name>
    <description>Run tests before handoff</description>
    <source>db</source>
  </skill>
</available_skills>

<available_instructions source="db">
  <instruction>
    <name>team-doc-style</name>
    <description>Keep docs aligned to shipped behavior</description>
    <source>db</source>
  </instruction>
</available_instructions>

<instructions source="db">
  <instruction>
    <name>interactive-prompt-loop</name>
    <description>Deterministic prompt-loop policy</description>
    <content>
...escaped inline markdown...
    </content>
  </instruction>
</instructions>

Use the manage_skills_and_instructions tool with action "get" to retrieve the full content of any skill or catalog instruction by name.
</system-reminder>
```

---

## Injection Triggers

The same startup-context builder is used by these bootstrap paths:

- `register_connection`
- MCP auto-register / reconnect via `maybeInjectDbContextOnConnect`
- SSE auto-register for newly observed OpenCode sessions
- post-compaction re-injection

All of these deliver the reminder as a `noReply: true` OpenCode user-message body, not through the per-call `system` field. That keeps the reminder replayable across later model steps.

---

## Live Update Behavior

`broadcastSkillsChanged` sends a small `<system-reminder>` after create/update/delete actions.

The reminder is mode-aware:

- **Skills**: tells the agent to use `get` for full content.
- **Catalog instructions**: tells the agent to use `get` for full content.
- **Always-mode instructions**: says updated content will be applied by future bootstrap injections and gives a minimal refresh hint.

This means immediate live-session behavior differs by delivery type:

- Catalog entries update via reminder + on-demand fetch.
- Always-mode instruction content is still a bootstrap concern, not an inline live re-send.

Example catalog-instruction update reminder:

```xml
<system-reminder>
A DB-stored instruction was updated: team-doc-style.
The latest list is available via the manage_skills_and_instructions tool with action "list".
Use action "get" with the instruction name to fetch its full content on demand.
</system-reminder>
```

---

## Session Filtering

Bootstrap inclusion is still filtered by session state:

- only `enabled` rows participate
- `global` rows are included unless muted for the session
- `session-scoped` rows are included only when the session opted in

That filtering applies before entries are split into skills, catalog instructions, and always-on built-in instructions.

---

## Matcher Behavior

The lightweight skill matcher is separate from bootstrap injection.

Current behavior:

- matches **skills only**
- scores both token overlap and bigram overlap
- weights exact name-token matches above description-only matches
- keeps limited substring fallback for close variants
- caps results to the strongest **two** matches
- suggestion text is built from that capped result set

This keeps skill suggestions small and avoids flooding the prompt with weak matches.

---

## See Also

- `desktop/src/main/tools/startup-context.ts`
- `desktop/src/main/tools/skill-match.ts`
- `desktop/src/main/tools/skills-broadcast.ts`
- `desktop/docs/TOOLS.md`
