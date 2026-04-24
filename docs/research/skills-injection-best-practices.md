# DB-Stored Skills & Instructions Injection vs. Ecosystem Patterns

Repo: `interactive-mcp-server` · Scope: research-only, no file modifications.

---

## 0. Executive summary

The framing "this repo always-injects all content on session start, which is the opposite of the dominant on-demand pattern" is **partially out of date**. Reading the current implementation:

- **Skills** (DB, `type='skill'`): injected only as `<name>` + `<description>` + `<source>db</source>` stubs. Full body is fetched on demand via `manage_skills_and_instructions` `action: "get"`. This already matches the Anthropic/OpenCode/file-based-skills pattern. See `desktop/src/main/tools/startup-context.ts:99-110` and `desktop/docs/SKILLS-INSTRUCTIONS-INJECTION.md:87-89`.
- **Instructions** (DB, `type='instruction'`): injected with **full `<content>` inlined verbatim** on every session bootstrap, and replayed on every model step because delivery uses a `noReply: true` user-message body (see `desktop/src/main/opencode/injector.ts:63` and `desktop/docs/SKILLS-INSTRUCTIONS-INJECTION.md:138-168`). This is the "always-inject" path — analogous to Cursor `alwaysApply: true` rules or Copilot `copilot-instructions.md`, but applied to _every_ row rather than a single curated file.
- A keyword matcher already exists (`desktop/src/main/tools/skill-match.ts:113-142`) and is wired through `withSkillSuggestion` (`desktop/src/main/ipc/handlers/shared.ts:29-38`) to prepend `[Skill suggestion: ...]` hints when a user's message keywords intersect a skill name/description.
- Scoping already goes beyond naive always-inject: schema v12 adds `scope` (`global` | `session-scoped`), `folder_id`, and a sibling `session_scoped_entries` table with per-session opt-in and a muted-names list (see `desktop/docs/SKILLS-INSTRUCTIONS-INJECTION.md:248-274` and `startup-context.ts:38-95`).

So the real questions are not "should skills be on-demand?" (they already are), but:

1. Are **instructions** too aggressive about always-inject, and should they gain the same tiers as skills?
2. Is the stub-catalog for skills paying a needless per-turn replay cost because it rides the same `noReply` user-message vehicle as always-on policy?
3. Is the keyword matcher strong enough to be the primary on-demand discovery signal, or is it a weak bolt-on today?
4. Does the DB tier duplicate the file-based (`.github/skills/`, `.agents/skills/`) tier, or is it a legitimately distinct persona?

---

## 1. Ecosystem comparison table

| System                                                                      | Storage                              | What the agent sees at session start                                                                                                                                                                                      | How full content loads                                                       | Selection signal                                                                                                       | Scoping mechanism                                                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Anthropic Agent Skills** (`~/.claude/skills/`, `SKILL.md` frontmatter)    | Filesystem, committed or user-global | Registry of `{name, description}` from directory scan                                                                                                                                                                     | `Skill` tool invocation by name; progressive disclosure of bundled files     | Model reads description, matches to task                                                                               | Per-repo, user-global (`~/.claude/skills`), org-wide via `/v1/skills`                                                     |
| **OpenCode native skills** (`.opencode/skills/`, `skill` tool)              | Filesystem, committed                | Name + description catalog surfaced in agent loop                                                                                                                                                                         | `skill` tool call                                                            | Model matches description to task                                                                                      | Repo + user-global                                                                                                        |
| **This repo, file-based** (`.github/skills/`, `.agents/skills/`)            | Filesystem, committed                | Injected as `<available_skills>` entries with name + description + `<location>file://…</location>`                                                                                                                        | Loaded via `skill` tool                                                      | Model matches description                                                                                              | Per-repo only                                                                                                             |
| **Cursor rules** (`.cursor/rules`)                                          | Filesystem, committed                | Rules with `alwaysApply: true` injected; rest are glob-scoped via `applyTo` matching open files                                                                                                                           | Inline content, deterministic                                                | File-pattern match (non-LLM)                                                                                           | `alwaysApply` flag + glob                                                                                                 |
| **GitHub Copilot** (`.github/instructions/*.md`, `copilot-instructions.md`) | Filesystem, committed                | `applyTo: '**'` → always; narrower globs → scope-gated                                                                                                                                                                    | Inline content, deterministic                                                | File-glob match (non-LLM)                                                                                              | `applyTo` globs                                                                                                           |
| **mem0 MCP**                                                                | Vector DB                            | **Nothing auto-injected**                                                                                                                                                                                                 | `add_memory` / `search_memory` tool calls                                    | Model-initiated semantic search                                                                                        | User/app/run IDs                                                                                                          |
| **`@modelcontextprotocol/server-memory`**                                   | Knowledge-graph JSONL                | **Nothing auto-injected**                                                                                                                                                                                                 | `read_graph` / `open_nodes` / `search_nodes` tools                           | Model-initiated                                                                                                        | None built-in; app concept                                                                                                |
| **This repo, DB-stored (current)**                                          | SQLite, `skills_and_instructions`    | Bootstrap `<system-reminder>` replayed every model step as a `noReply` user message: header + `<available_skills>` stubs (name+desc only) + `<instructions>` full content + keyword-match hints prepended to user prompts | Skills via `manage_skills_and_instructions get`; instructions already inline | Stubs read by model + `skill-match.ts` keyword matcher prepends suggestions; scope filter gates session-scoped entries | `enabled` flag, `scope ∈ {global, session-scoped}`, `session_scoped_entries` opt-in, `sessionMutedNames` per-session mute |

### Patterns visible in this table

1. **Stubs + on-demand body is the near-universal pattern** for anything the agent is expected to reach for by task fit (Claude Skills, OpenCode skills, this repo's file-based skills).
2. **Deterministic non-LLM gating** is used by exactly two systems — Cursor and Copilot — and in both cases the gate is _file globs_, not keywords. Everyone else delegates selection to the model via descriptions.
3. **No widely-used MCP server auto-injects large persisted content on session start.** mem0 and `server-memory` both expose tools and rely on the agent to call them.
4. **No widely-used system inlines full content for every row of a user-edited registry.** The closest analogue is `.github/copilot-instructions.md`, which is a _single curated file_, not an unbounded list.
5. **Nobody except this repo replays the bootstrap on every model step.** The replay is a deliberate workaround for OpenCode dropping per-call `system` content after the first real user turn (see `desktop/docs/SKILLS-INSTRUCTIONS-INJECTION.md:160-164`), but it compounds the token-cost asymmetry of inlined instructions.

---

## 2. Evaluation — always-inject vs. on-demand

### 2a. Token-cost model

Per-row ballpark (excluding XML overhead):

- Skill stub: `name` (~20 tok) + `description` (~30 tok) + wrapper (~10 tok) ≈ **60 tok**.
- Instruction full-inline: description (~30) + `<content>` body. Typical built-in bodies in this repo (`llm-coding-guidelines`, `agent-orchestration-policy`, `user-interaction`, `interactive-prompt-loop`) are **800–2,500 tok each**.
- Bootstrap header + XML scaffold: ~200 tok fixed.

For a modestly sized user (5 instructions, 15 skills):

| Strategy                                                | Bootstrap tokens | Cost per session of 50 turns (bootstrap is replayed every turn) |
| ------------------------------------------------------- | ---------------- | --------------------------------------------------------------- |
| **Current** (skill stubs + full instructions, replayed) | ~8,600           | ~430k                                                           |
| Full-inline everything                                  | ~30,200          | ~1.5M                                                           |
| Stubs-only for both                                     | ~1,400           | ~70k                                                            |
| Nothing (pure on-demand)                                | 0                | 0                                                               |

The replay-every-step behavior is the dominant factor. At 50 turns the inlined instructions alone cost ~375k tokens of repeated context — not free even at Opus/Sonnet pricing tiers.

### 2b. Discoverability tradeoff

- **Always-inline instructions**: the agent cannot miss them. Correct for content that is a _precondition to any tool call_ (prompt-loop policy, stop phrases, `openCodeSessionId` requirement). Wrong for content that is a _task-specific workflow_ (coding guidelines).
- **Stubs + on-demand**: works when the model is primed to scan the catalog. Works well in practice for skills because task-skill matching has strong signals (names map cleanly to task verbs). Works less well for cross-cutting concerns that have no obvious trigger.
- **Stubs + keyword matcher hint**: current hybrid for skills. Solid pattern — the catalog is the schema, the matcher is the attention nudge. The existing matcher is weak (see R2) but the shape is right.
- **Pure on-demand with no pre-registered catalog** (mem0 model): fails in practice for task-tied knowledge because agents rarely call discovery tools unprompted. Works for memory because the agent is explicitly told to.

### 2c. When always-inject is actually correct

All of these must hold:

1. Content is a **precondition** to any action, not a response to a task shape.
2. Content is **short** (≤ ~300 tok) so the per-turn replay cost is tolerable.
3. The set of such items is **bounded and curated**, not "any row the user flags".
4. Content does **not** vary per task, per file, per repo — otherwise scope-gating is strictly better.

In this repo, these four constraints are clearly met by: prompt-loop policy summary, stop phrases, `openCodeSessionId` injection rule, satisfaction-check directive. They are **not** met by: `llm-coding-guidelines`, `agent-orchestration-policy` (long version), most user-authored instructions.

---

## 3. Should DB-stored skills become even more on-demand?

Skills are _already_ on-demand. Realistic further moves:

### Option A — Drop stub catalog entirely, rely on `list_skills` tool

- Pro: zero bootstrap cost for skills. Matches mem0.
- Con: agents in practice rarely call discovery tools unprompted. The whole reason Claude/OpenCode skills work is that the runtime _pre-populates_ names into the context. Removing the stubs here would likely kill discoverability.
- Verdict: **not recommended**.

### Option B — Keep stubs, but stop replaying them every turn

Split delivery: `<instructions>` continue to ride the `noReply` user message (replayed every step); `<available_skills>` catalog is sent once at session start as a non-replayed system-style message, with a short reminder that `manage_skills_and_instructions list` can refresh it.

- Pro: saves ~60 tok × N_skills per turn, compounding over long sessions.
- Con: the agent may "forget" the skill catalog 20 turns in. Partially mitigated by the keyword matcher, which surfaces names on-demand.
- Verdict: **medium-impact, low-medium effort. See R3.**

### Option C — Keep current skill model, invest in the matcher

Stubs stay in the replayed bootstrap (per-skill cost is small). The keyword matcher is upgraded to produce better signals.

- Pro: no risk of dropped discoverability; small incremental cost; pays the biggest UX dividend.
- Con: keeps paying small replay cost.
- Verdict: **recommended as the first move. See R2.**

---

## 4. Do file-based and DB-stored skills duplicate each other?

**No, provided the two tiers have clearly different personas.** Today they already do:

| Dimension       | File-based (`.github/skills/`, `.agents/skills/`, `.opencode/skills/`)        | DB-stored (this subsystem)                                 |
| --------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Audience        | Repo team                                                                     | Individual user, across repos                              |
| Lifecycle       | Git-tracked, PR-reviewed, slow                                                | Live-edited in Settings UI                                 |
| Trust boundary  | Shared, reviewed                                                              | User-private                                               |
| Scope           | Bound to repo                                                                 | Machine-global; per-session opt-in                         |
| Delivery        | Injected by OpenCode's own file scan, `<location>file://…</location>` markers | Injected by the desktop app, `<source>db</source>` markers |
| Typical content | Repo workflows, codified conventions                                          | User's personal workflows, experiments, cross-repo rules   |

The `<source>db</source>` / `<location>file://…</location>` wire markers are the correct disambiguation mechanism. The real risk is a DB row and a file row sharing a `name` — agents may resolve them inconsistently. Mitigate in the UI (R5).

**Conclusion**: the DB tier is a legitimate non-redundant niche (user-private, runtime-editable). Keep it.

---

## 5. What do other MCP servers do for persistent user context?

- **mem0 MCP**: tool-surface only — `add_memory`, `search_memory`, `list_memories`. Nothing auto-injected. Expects the agent's system prompt to instruct it to consult memory.
- **`@modelcontextprotocol/server-memory`**: knowledge-graph tools (`read_graph`, `open_nodes`, `add_observations`). Nothing auto-injected.
- **Memory-bank style MCPs** (various community implementations): same pattern — tools only.
- **Letta / Zep**: live at the agent-runtime layer, not the MCP layer. Auto-inject happens in their own SDK before the model call, not via MCP.

**Takeaway**: no MCP server in common use auto-injects large persisted content at session start. This repo's choice to do so is _unusual_, but it is addressing a different problem — delivering **desktop-app policy** that the agent cannot discover via tool calls (prompt loop, stop phrases, session-ID requirement). That is a legitimate niche memory-MCPs do not cover.

The imported lesson: **content that is user knowledge (not server policy) should live on a tool surface, not in auto-injected context.** Some current DB instructions (notably `llm-coding-guidelines`) are user knowledge drifting into the server-policy tier. See R6.

---

## 6. Recommendations (ranked by impact × effort)

### R1 — Tier instructions the same way skills are tiered. (HIGH impact, LOW effort)

**Problem.** Every `type='instruction'` row is inlined in full, every turn. There is no equivalent of the skill `get` path. A user who registers five long instructions pays full replay on all of them forever.

**Proposal.** Add an `injection_mode` column to `skills_and_instructions`:

- `always` — current behavior (full `<content>` inlined, replayed every turn).
- `catalog` — name+description in `<available_instructions>` block; body fetched via `manage_skills_and_instructions get`. Mirrors today's skill behavior.
- `suggest` — catalog entry PLUS participation in the keyword matcher; a `[Instruction suggestion: …]` hint is prepended when relevant.

Migration: built-in rows (`interactive-prompt-loop`, `user-interaction`, satisfaction-check policy) default to `always`. Everything else defaults to `suggest`. Surface a Settings dropdown: _Always active_ / _Available on demand_ / _Suggest when relevant_.

**Effort.** ~1–2 days. Two-column migration + three branches in `buildStartupContextMessage` (`desktop/src/main/tools/startup-context.ts:46-136`) + a `<available_instructions>` block + UI dropdown.

**Risks/downsides.**

- Agents that today see the content unconditionally will need to learn to fetch — the catalog hint must be conspicuous.
- Migration must correctly preserve always-on semantics for the four built-in policy rows, or the prompt-loop regresses.
- `broadcastSkillsChanged` must carry the tier so the change reminder is right-sized (a body edit to a `suggest` instruction should not send the full new body down the wire).

---

### R2 — Upgrade the keyword matcher. (HIGH impact, LOW-MEDIUM effort)

**Problem.** `desktop/src/main/tools/skill-match.ts:113-142` tokenizes on non-alphanumeric boundaries, drops short tokens and stop-words, and matches via substring containment. This is barely better than chance for general phrasing and produces false positives on common words.

**Proposal, in order of payoff.**

1. **Bigrams/trigrams** over the description: a query containing "pull request" should match a skill whose description contains "pull request" even when neither token alone is distinctive. Implementation: a second pass that builds n-gram sets (n=2,3) from both sides and checks intersection.
2. **Match against tool-call context, not just user prompts.** Hook into the SSE tool-call stream (the same stream session-tree-service already consumes). If the agent is about to call `bash` with `npm test`, the `run-tests` skill should surface. Implementation: add a `handleToolCallForSuggestions()` path that runs the matcher against `{toolName, stringifiedArgs}` and fires `injectOpenCodeMessage` with a short `[Skill suggestion: …]` reminder when a match fires.
3. **Per-row `triggers` column** — optional JSON array of glob/regex/keyword patterns. Mirrors Cursor/Copilot `applyTo`. When a trigger matches a file path or tool name in the current turn, the skill is suggested deterministically, independent of description quality.
4. **(Stretch) Embedding similarity.** One-shot local embed of every skill description at app start, cached; embed the prompt on each turn; cosine-similarity top-k. Requires a local model dependency. Overkill for small catalogs; justifies its weight only at ≥100 skills.

Steps (1)–(3) are deterministic, cheap, and add no new runtime dependency.

**Effort.** 1–2 days for (1)+(2)+(3); ~1 week for (4).

**Risks/downsides.**

- False positives create noise in the model's context. Mitigate with: hard cap `N ≤ 2` suggestions per turn; suppress on prompts under ~10 chars; suppress when no keyword has length ≥ 5.
- Tool-call interception (step 2) arrives _during_ a turn — the injection must be enqueued before the next model step, or it is noise. In practice OpenCode's multi-step turns give ample time, but the plumbing must respect the step cadence.
- Triggers (step 3) overlap semantically with `applyTo` globs — users may get confused about which layer wins. Mitigate by documenting: triggers are OR'd with description match.

---

### R3 — Stop per-turn replay of the skill stub catalog. (MEDIUM impact, LOW effort)

**Problem.** The bootstrap rides a `noReply: true` user message so OpenCode replays it every step. This is the right vehicle for always-on _instructions_, but the _skill catalog_ is a reference table — 15 stubs × 60 tok × every turn = 45k tokens over a 50-turn session, spent on content the model rarely needs to re-read.

**Proposal.** Split delivery into two injections at session bootstrap:

1. **Replayed message** (`noReply: true`, persisted in `messages[]`): bootstrap header + `<policies>` block (always-mode instructions only).
2. **One-shot message** (injected once at session start, _not_ in a replay-eligible slot): `<available_skills>` catalog + `<available_instructions>` catalog entries for `catalog`/`suggest` modes. Short trailing line: "Use `manage_skills_and_instructions list` to re-fetch the catalog; `get` to load content."

The keyword matcher (R2) continues to prepend just-in-time suggestions so the model sees skill names on demand even after they've scrolled out of visible context.

**Effort.** ~0.5–1 day. Requires one extra `injectOpenCodeMessage` call with a different delivery flag (or a fresh `user` part with no `noReply` replay tag, depending on which OpenCode vehicle is chosen).

**Risks/downsides.**

- If OpenCode's summarization/compaction drops the one-shot message, the agent loses the catalog mid-session. Mitigations: (a) re-send the catalog in the post-CRUD diff broadcast when a skill changes; (b) ensure `manage_skills_and_instructions list` is described prominently enough that the model falls back to it.
- Requires careful interplay with the dedupe set (`db-context-injection.ts:45`, `_injectedSessionIds`) so the one-shot doesn't fire twice across triggers (a)–(d) in `SKILLS-INSTRUCTIONS-INJECTION.md:29-68`.

---

### R4 — Move the matcher onto tool-call events. (MEDIUM impact, MEDIUM effort)

**Problem.** `withSkillSuggestion` only runs for user-originated messages relayed through IPC (`shared.ts:29-38`). Agent-initiated sub-turns, tool calls, and sub-agent spawns get no suggestion hints — exactly the turns where a skill would be most relevant.

**Proposal.** Subscribe the matcher to the existing SSE tool-call stream (`session-tree-service.ts`, `sse-handlers.ts`). On every `tool.call.*` event, run the matcher against `{toolName, JSON.stringify(args).slice(0, 400)}`. If it hits and no suggestion for that skill has fired in the last N seconds, enqueue a `<system-reminder>` via `injectOpenCodeMessage`.

**Effort.** 2–3 days. Adds a new pipeline that must be throttled and deduped; otherwise a multi-step loop will spam suggestions.

**Risks/downsides.**

- Timing — a suggestion that arrives after the agent has committed to the next step is wasted. Acceptable in practice because OpenCode reads context on each model call, but monitor.
- Noise — sub-agents doing many tool calls will generate many match events. Strict per-skill-per-session cooldown (e.g., one suggestion per skill per 5 minutes) is required.

---

### R5 — Surface file-vs-DB provenance and name collisions in the UI. (MEDIUM impact, LOW effort)

**Problem.** A DB skill named `code-review` and a file-based skill at `.github/skills/code-review/SKILL.md` both reach the agent, with identical names. Nothing warns the user.

**Proposal.** On the Settings skills page: for each DB row, scan `.github/skills/`, `.agents/skills/`, `.opencode/skills/`, `~/.claude/skills/`, and show a badge when a same-named file-based skill exists. Optionally let the user mute the DB row for repos where the file-based version ships.

**Effort.** ~0.5 day.

**Risks/downsides.** None significant. Scan needs to be cheap (glob + frontmatter header) and re-run on directory change.

---

### R6 — Move user-knowledge out of `type='instruction'`. (LOW-MED impact, LOW effort)

**Problem.** Some current built-in instructions are really _task-shaped knowledge_ misrouted through the policy channel. `llm-coding-guidelines` is the canonical example: long, general, not a precondition to any specific tool call. It gets inlined and replayed on every turn.

**Proposal.** Audit built-ins. Keep as `instruction` with `injection_mode='always'` only those that are genuine preconditions to any tool call:

- `interactive-prompt-loop` (short version)
- user-interaction stop phrases
- `openCodeSessionId` requirement
- mandatory satisfaction check directive

Re-classify as `type='skill'` or `injection_mode='suggest'`:

- `llm-coding-guidelines`
- long-form `agent-orchestration-policy` (keep a short policy pointer as `always`)
- any verbose how-to content

**Effort.** Few hours. Requires aligning the built-in seed data and the `SKILLS-INSTRUCTIONS-INJECTION.md` doc.

**Risks/downsides.** Short-term: agents may skip guidelines that were previously unmissable. The suggestion mechanism (R2) is the intended mitigation. Monitor with eval traces.

---

### R7 — Expose per-session mute/opt-in directly in the UI. (LOW impact, LOW effort)

**Problem.** `sessionMutedNames` and `session_scoped_entries` exist in the schema and are honored by `buildStartupContextMessage` (`startup-context.ts:38-95`), but the UX for toggling them per-session is narrow (today primarily an inline composer panel).

**Proposal.** Add a "Context for this session" drawer that lists all enabled entries for the active session with three toggle states: active / muted-this-session / opted-in-this-session. Wire to the existing `set-session-scoped-entries` IPC (and the corresponding mute setter, if missing, add it).

**Effort.** ~0.5–1 day.

**Risks/downsides.** Adds surface area. Keep it a power-user drawer, not the default pane.

---

### R8 — (Speculative) Export DB skills as on-disk `SKILL.md` for portability. (LOW impact, LOW effort)

**Problem.** DB skills are invisible to non-OpenCode agents (Claude Code running alone, Copilot CLI, etc.) and to any tool that reads the emerging [agentskills.io](https://agentskills.io) format.

**Proposal.** Optional "Export to `SKILL.md`" action that writes each DB skill to `~/.claude/skills/<name>/SKILL.md` with Anthropic-compatible frontmatter. Two-way sync is out of scope; export is one-shot.

**Effort.** ~1 day.

**Risks/downsides.** Drift between DB and exported copies. Document as one-shot and don't attempt sync.

---

## 7. Concrete redesign sketch (combining R1 + R2 + R3 + R6)

### Schema delta

```sql
ALTER TABLE skills_and_instructions
  ADD COLUMN injection_mode TEXT NOT NULL DEFAULT 'catalog'
    CHECK (injection_mode IN ('always','catalog','suggest'));

ALTER TABLE skills_and_instructions
  ADD COLUMN triggers TEXT;  -- JSON array, optional
```

Migration: set `injection_mode='always'` for the four built-in policy rows (`interactive-prompt-loop`, `user-interaction`, satisfaction-check, stop-phrase). Set `'suggest'` for the rest of existing instructions. Skills migrate to `'catalog'`.

### `buildStartupContextMessage` branches

Pseudocode:

```
for entry in filtered(enabled & scope & mute):
  if entry.injection_mode == 'always':
    policies.push(full <instruction> with <content>)
  else:
    catalog.push({type, name, description, mode: entry.injection_mode})

replayedMessage   = bootstrap_header + <policies>...
oneShotMessage    = <available_skills>... + <available_instructions>...
```

### Wire delivery

- **Replayed message**: `injectOpenCodeMessage(..., noReply: true)` — rides `messages[]`, replayed every step. Contains only policies + bootstrap header.
- **One-shot catalog**: a second `injectOpenCodeMessage` at session bootstrap using a delivery mode that does not replay (e.g., a standalone `user` part without the always-replay tag, or a system-slot injection tolerated because it covers only this first turn — trade-off documented in `SKILLS-INSTRUCTIONS-INJECTION.md:160-164`).

### Matcher pipeline

```
onUserMessage(msg):
  suggest(matcher(msg, catalog.filter(mode ∈ {catalog, suggest})))

onToolCall(evt):
  suggest(matcher(`${evt.toolName} ${truncate(evt.args)}`, catalog))

suggest(matches):
  matches = top-2 by score, throttled per-entry per-5-min
  if any: injectOpenCodeMessage(<system-reminder> suggestion ...)
```

Matcher internals: tokens + bigrams + triggers, scored and deduped.

### Settings UI changes

- Per-entry tier dropdown: _Always active_ / _Available on demand_ / _Suggest when relevant_.
- Optional _Triggers_ text field (comma-separated patterns).
- Per-session drawer: mute global / opt-in session-scoped.
- Provenance badge when a same-named file-based skill exists.

### Broadcast diff

`broadcastSkillsChanged` (`manage-skills-and-instructions.ts:30`, `skills-broadcast.ts`) needs to know the entry's tier so it can right-size the reminder:

- Change to an `always` entry → reminder mentions content will be re-injected on next bootstrap (or push a minimal full-content update).
- Change to a `catalog`/`suggest` entry → reminder points to `get`.

### Risks and downsides of the combined redesign

- **State explosion** — 3 tiers × 2 scopes × mute list ≈ 12 logical states. Mitigate by defaulting `suggest` for user rows and hiding advanced knobs.
- **Model drift** — Claude/OpenCode may treat a `<policies>` vs `<available_instructions>` split differently than the single `<instructions>` block does today. Validate with eval traces before rolling out broadly.
- **Broadcast correctness** — every mutation path (`upsert-skill-or-instruction`, `toggle-enabled`, `delete`, `set-scope`, `set-session-scoped-entries`) must carry the tier. The existing table at `SKILLS-INSTRUCTIONS-INJECTION.md:223-230` grows a column.
- **Dedupe set interaction** — the one-shot and the replayed messages both come through `injectOpenCodeMessage`; `_injectedSessionIds` must key on (session, injectionKind) rather than just session, or the one-shot suppresses the replayed (or vice versa) on re-register.
- **Migration safety** — a botched migration that flips built-in policy rows to `catalog` silently breaks the prompt-loop invariants. Make the migration assertive and test-covered.

---

## 8. Things not to do

- **Do not** remove bootstrap injection entirely (mem0-style). Desktop-app policy — prompt loop, stop phrases, satisfaction check — genuinely needs always-active delivery and cannot be reliably discovered via tool calls.
- **Do not** merge DB skills into the file-based tier. They serve distinct personas (user-private, runtime-editable).
- **Do not** build embedding-based matching before the keyword matcher is fixed (R2 steps 1–3). The latter is 10× cheaper and probably 80% as effective at current catalog sizes.
- **Do not** auto-migrate user-created instructions from always-on to `catalog` or `suggest` without explicit opt-in — that silently changes observable behavior users depended on.
- **Do not** treat the keyword matcher as a replacement for the stub catalog — the catalog is what the matcher queries _against_, and it is also the primary discovery surface for the model itself.

---

## 9. Ranked summary

| #   | Recommendation                                                                    | Impact      | Effort  | Risk    |
| --- | --------------------------------------------------------------------------------- | ----------- | ------- | ------- |
| R1  | Tier instructions (`always` / `catalog` / `suggest`) with `injection_mode` column | High        | 1–2 d   | Low     |
| R2  | Upgrade keyword matcher (bigrams + triggers + tool-call context)                  | High        | 1–2 d   | Low     |
| R3  | Split bootstrap: replay only `<policies>`, one-shot the catalog                   | Medium      | 0.5–1 d | Low–Med |
| R4  | Matcher hints on SSE tool-call events                                             | Medium      | 2–3 d   | Med     |
| R5  | Surface DB-vs-file provenance and name collisions in UI                           | Medium      | 0.5 d   | None    |
| R6  | Re-classify user-knowledge out of `type='instruction'`                            | Low–Med     | hours   | Low     |
| R7  | Per-session mute/opt-in drawer in UI                                              | Low         | 0.5–1 d | None    |
| R8  | Export DB skills to on-disk `SKILL.md` for portability                            | Speculative | ~1 d    | None    |

**Biggest win with least risk: R1 + R2 together**, ~3 developer-days, two small schema changes, no delivery-vehicle surgery. R3 follows naturally once tiers exist.
