# Research Reports

Research-only reports produced by subagents. No code was modified while producing these.

## Skills & Instructions Injection

Three complementary investigations into how DB-stored skills/instructions are injected into agent sessions:

1. [`skills-injection-map.md`](./skills-injection-map.md) — **Mechanics map.** Complete code path map (file:line), sequence diagrams for all four injection entry points, documentation-vs-code gaps, and the files that would need to change for any modification.
2. [`skills-injection-audit.md`](./skills-injection-audit.md) — **Correctness audit.** 16 findings ranked by severity, covering duplication, staleness, prompt-injection via unescaped XML, size limits, scoping, races, and silent failures. Includes a recommended remediation order.
3. [`skills-injection-best-practices.md`](./skills-injection-best-practices.md) — **Ecosystem comparison & redesign.** Compares this repo to Anthropic Skills, OpenCode skills, Cursor rules, Copilot instructions, mem0, and `server-memory`. Proposes a tiered redesign (`always` / `catalog` / `suggest`) with 8 ranked recommendations.

## Desktop RAM Management

4. [`release-session-button.md`](./release-session-button.md) — **Close/release-session button feasibility.** Full implementation plan for a channel-header button that frees per-session RAM without permanently deleting the channel. Includes UX recommendation (Release vs Archive vs Close+Delete-upstream), file:line anchors, ~300 LOC implementation plan across 13 files, risks, and effort estimate (M).

## Reading order

If you want to act on findings quickly:

- **Fix bugs first** → start with `skills-injection-audit.md` (findings 1–5 are cheap to fix and include the prompt-injection issue).
- **Plan a redesign** → `skills-injection-best-practices.md` (R1 + R2 together, ~3 days).
- **Ship the RAM button** → `release-session-button.md` (half a day to one day).
- **Understand current behavior before changing anything** → `skills-injection-map.md`.
