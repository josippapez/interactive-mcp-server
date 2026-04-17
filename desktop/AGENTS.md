# Desktop package — agent guide

This file is a pointer. The authoritative agent rules for the whole
repository live in the root [`AGENTS.md`](../AGENTS.md); read it first.

---

## Patterns & Skills

Patterns and step-by-step workflows specific to the desktop package are
catalogued here:

| Human-facing doc                                         | Agent-facing skill                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [`docs/PATTERNS.md`](./docs/PATTERNS.md)                 | —                                                                                                |
| [`docs/ADDING-A-FEATURE.md`](./docs/ADDING-A-FEATURE.md) | —                                                                                                |
| `PATTERNS.md §1 — IPC handler pattern`                   | [`.agents/skills/add-ipc-handler`](../.agents/skills/add-ipc-handler/SKILL.md)                   |
| `PATTERNS.md §4 — Settings section pattern`              | [`.agents/skills/add-settings-section`](../.agents/skills/add-settings-section/SKILL.md)         |
| `PATTERNS.md §3 — Renderer IPC consumption`              | [`.agents/skills/add-renderer-hook`](../.agents/skills/add-renderer-hook/SKILL.md)               |
| `PATTERNS.md §5 — Custom agents & OpenCode config`       | [`.agents/skills/add-custom-agent-or-tool`](../.agents/skills/add-custom-agent-or-tool/SKILL.md) |

When in doubt: read `docs/PATTERNS.md` first, then load the matching skill
for the task at hand.
