# Automatic Repository Doc Indexing — Design Plan

> **Status: Shipped.** This feature is fully implemented. The modules described below (`doc-indexer.ts`, `doc-context-injector.ts`, `tools/find-repo-docs.ts`) exist in the codebase and are active. The `find_repo_docs` MCP tool is registered on every connection, doc manifests are injected on `register_connection`, and the background semantic indexer runs in a worker thread. See [`TOOLS.md`](./TOOLS.md#find_repo_docs) for the tool reference and [`ARCHITECTURE.md`](./ARCHITECTURE.md) for module placement.

---

## Motivation

When an AI agent connects to the desktop app via `register_connection` with a `baseDirectory`, the app already knows which repository the agent is working in. However, the agent has no automatic awareness of what documentation exists in that repository. Today, agents rely on manually configured instruction files or MCP tools to discover docs.

This feature will:

1. **Automatically discover** all documentation files (`.md`, `.mdx`) in the agent's repository.
2. **Index them** using hybrid keyword + semantic search for fast, accurate retrieval.
3. **Inject relevant doc paths** into the agent's OpenCode session context via the existing noReply mechanism — so the agent knows what docs are available without any manual setup.
4. **Expose an MCP tool** (`find_repo_docs`) for on-demand semantic doc search.

---

## Package Choice

### `@huggingface/transformers` v3 (replaces `@xenova/transformers` v2)

The current `tools/mcp/` implementation uses `@xenova/transformers` v2.17.2. This package is **unmaintained** — the author (Xenova) joined HuggingFace and the project was officially succeeded by `@huggingface/transformers` v3.

| Aspect          | `@xenova/transformers` v2             | `@huggingface/transformers` v3 |
| --------------- | ------------------------------------- | ------------------------------ |
| **Maintenance** | Archived, no new releases             | Active, regular releases       |
| **API**         | `pipeline('feature-extraction', ...)` | Same API, drop-in compatible   |
| **Models**      | ONNX-converted models on HF Hub       | Same + newer model support     |
| **WebGPU**      | No                                    | Yes (future-proofing)          |
| **Node.js**     | Full support                          | Full support                   |

**Decision:** Use `@huggingface/transformers` v3 in the desktop app. Migrate `tools/mcp/` to use it as well in a follow-up task.

### Embedding Model

**`Xenova/all-MiniLM-L6-v2`** (384 dimensions, ~23MB ONNX model)

This model remains the best choice for this use case:

- Fast inference (< 50ms per embedding on CPU)
- Good semantic quality for English technical documentation
- Small download size
- Well-tested in the existing `tools/mcp/` implementation
- Available on HuggingFace Hub in ONNX format

Alternatives considered but deferred:

| Model                                 | Dims | Size  | Trade-off                                     |
| ------------------------------------- | ---- | ----- | --------------------------------------------- |
| `mixedbread-ai/mxbai-embed-xsmall-v1` | 384  | ~30MB | Marginally better benchmarks, larger download |
| `BAAI/bge-small-en-v1.5`              | 384  | ~33MB | Similar quality, heavier                      |
| `Xenova/all-MiniLM-L6-v2`             | 384  | ~23MB | **Best balance for our use case**             |

---

## Search Strategy: Hybrid Keyword + Semantic

The strongest search approach for documentation is **hybrid scoring** — combining keyword matching (precision) with semantic similarity (recall). This is the same approach used in `tools/mcp/tools/docs.cjs` and is well-proven.

### Why hybrid beats either approach alone

| Approach          | Strengths                                                            | Weaknesses                                                                         |
| ----------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Keyword only**  | Exact term matching, fast, no model needed                           | Misses synonyms ("auth" won't find "authentication"), no conceptual understanding  |
| **Semantic only** | Understands meaning, finds conceptual matches                        | Can miss exact terms, requires model warm-up, lower precision for specific queries |
| **Hybrid**        | Best of both — exact matches rank high, conceptual matches fill gaps | Slightly more complex scoring logic                                                |

### Scoring algorithm

The scoring algorithm merges keyword and semantic signals into a single ranked list:

#### Phase 1: Keyword scoring (always runs, no model required)

For each doc file:

1. **Tokenize query** — lowercase, split on non-alphanumeric (keep `@._/-`), remove English stop words.
2. **Path match** — +4 points per token found in the file's relative path.
3. **Content match** — +1 point per occurrence of each token in file content (capped at 3 per token).
4. **Title bonus** — +3 points per token found in the first `# ` heading.
5. **Directory context bonus** — +4 for `/standards/` with standards-related query terms, +2 for `/guides/` with guide-related terms.

#### Phase 2: Semantic augmentation (runs when embedding worker is ready)

1. **Embed query** — first 500 chars through `all-MiniLM-L6-v2`.
2. **Cosine similarity** — dot product against cached doc vectors (pre-normalized).
3. **Score conversion** — `Math.round(similarity * 14)` for hits with `similarity > 0.3`.
4. **Merge** — add semantic score to existing keyword score, or create new entry for semantic-only hits.

#### Phase 3: Final ranking

Sort by combined score descending, take top N results.

---

## Architecture

### New modules

```
desktop/src/main/
├── doc-indexer.ts          ← NEW: worker-thread semantic indexer + hybrid search
├── doc-context-injector.ts ← NEW: orchestrates doc discovery + noReply injection
├── opencode-injector.ts    (existing — reused for the actual HTTP POST)
├── tools/
│   └── find-repo-docs.ts   ← NEW: MCP tool for on-demand doc search
└── ...
```

### Module responsibilities

#### `doc-indexer.ts` — Semantic indexer (worker thread)

Replicates the pattern from `tools/mcp/semantic-index.cjs` but in TypeScript for the Electron main process.

**Worker thread side:**

```
1. Import @huggingface/transformers dynamically
2. Load feature-extraction pipeline with Xenova/all-MiniLM-L6-v2
3. Post { type: 'ready' } to parent
4. Listen for { type: 'embed', id, text } messages
5. Compute embedding with { pooling: 'mean', normalize: true }
6. Reply with { type: 'embed', id, vector }
```

**Main thread side (exports):**

```typescript
// Lifecycle
warmUp(): void              // Spawn the worker thread
isReady(): boolean           // Check if worker is ready
shutdown(): void             // Terminate the worker

// Embedding
embedText(text: string): Promise<number[] | null>

// Cache
loadCache(baseDirectory: string): DocEmbeddingCache
saveCache(baseDirectory: string, cache: DocEmbeddingCache): void

// Search
findSemantic(query: string, docFiles: string[], baseDirectory: string, limit: number): Promise<ScoredDoc[]>

// Hybrid search (keyword + semantic)
findDocs(query: string, baseDirectory: string, limit: number): Promise<DocSearchResult[]>
```

**Cache location:** `<baseDirectory>/.doc-embeddings.json`

**Cache format:**

```json
{
  "docs/guides/setup.md": {
    "mtime": 1719500000000,
    "vector": [0.012, -0.034, ...],
    "title": "Project Setup Guide",
    "snippet": "This guide walks through..."
  }
}
```

**Cache invalidation:** By file `mtimeMs` — if the modification time changes, the file is re-embedded.

#### `doc-context-injector.ts` — Orchestrator

Responsible for:

1. **Discovering docs** in a repository — walks `docs/`, collects `README.md` files from project roots, finds `.md`/`.mdx` files. Uses the same `SKIP_DIRS` set as `tools/mcp/config.cjs`.
2. **Building the doc manifest** — list of `{ path, title, snippet }` for all discovered docs.
3. **Injecting the manifest** via noReply into the OpenCode session.
4. **Triggering background indexing** — kicks off semantic embedding via `doc-indexer.ts` (non-blocking, so registration isn't delayed).

```typescript
// Called from register_connection when baseDirectory is provided
export async function initDocContext(
  baseDirectory: string,
  openCodeSessionId: string,
  openCodePort: number,
): Promise<void>;

// Called from find_repo_docs tool
export async function searchDocs(
  query: string,
  baseDirectory: string,
  limit: number,
): Promise<DocSearchResult[]>;
```

#### `tools/find-repo-docs.ts` — MCP tool

A new MCP tool registered on each connection's `McpServer`:

```typescript
find_repo_docs({
  query: string;   // Required. Search query for repository docs.
  limit?: number;  // Optional. Max results (1-20, default 8).
}): string         // Returns ranked list of doc paths with scores and snippets.
```

**Tool description** (shown to agents):

```
Search repository documentation files by query. Uses hybrid keyword + semantic
search to find the most relevant docs. Returns file paths and snippets — use
the Read tool to access full content. Only available when the agent registered
with a baseDirectory.
```

**Output format:**

```
Top doc matches for "authentication setup":

1. docs/guides/auth-setup.md (score: 18)
   L12: ## Setting up authentication with JWT

2. docs/standards/security.md (score: 14)
   L45: All API endpoints must validate authentication tokens

3. README.md (score: 8)
   L23: See docs/guides/auth-setup.md for authentication guide
```

---

## Trigger Flow

### A. Automatic injection on `register_connection`

```
Agent calls register_connection({ baseDirectory: '/path/to/repo', ... })
    │
    ├── [existing] Auto-detect OpenCode session
    ├── [existing] Upsert registered_connections in SQLite
    ├── [existing] Write ID file to /tmp
    ├── [existing] Send connection-registered IPC to renderer
    │
    └── [NEW] initDocContext(baseDirectory, openCodeSessionId, openCodePort)
              │
              ├── 1. Discover doc files in baseDirectory
              │      Walk docs/, collect README.md files,
              │      find *.md/*.mdx in project roots
              │
              ├── 2. Extract title (first # heading) from each file
              │
              ├── 3. Inject doc manifest via noReply
              │      POST { noReply: true, parts: [{ type: 'text', text: manifest }] }
              │
              └── 4. Background: warmUp() + buildCache(baseDirectory)
                     (non-blocking — semantic search available on next query)
```

### B. On-demand search via `find_repo_docs` tool

```
Agent calls find_repo_docs({ query: 'authentication setup' })
    │
    ├── [guard] staleConnectionError check
    ├── [guard] Check baseDirectory is set for this connection
    │
    └── searchDocs(query, baseDirectory, limit)
              │
              ├── Phase 1: Keyword scoring (always available)
              ├── Phase 2: Semantic augmentation (if worker is ready)
              └── Return ranked results with paths, scores, snippets
```

---

## What Gets Injected (noReply format)

The automatic injection on registration sends a **doc manifest** — a list of all discovered documentation paths with their titles. This is injected as a `<system-reminder>` so agents treat it as context rather than a user message.

### Manifest format

```
<system-reminder>
Repository documentation index for /Users/you/project:

Guides:
  - docs/guides/setup.md — Project Setup Guide
  - docs/guides/deployment.md — Deployment Instructions
  - docs/guides/authentication.md — Authentication Setup

Standards:
  - docs/standards/coding.md — Coding Standards & Conventions
  - docs/standards/testing.md — Testing Requirements

Patterns:
  - docs/patterns/01-module-structure.md — Module Structure
  - docs/patterns/02-component-patterns.md — Component Patterns

Other:
  - README.md — Project Overview
  - CONTRIBUTING.md — Contributing Guide

Use the Read tool to access any of these files when needed.
Use the find_repo_docs tool to search docs by query.
</system-reminder>
```

### Design decisions for injection content

| Decision                         | Rationale                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| **Paths only, not full content** | Full content would consume too many tokens. Paths let the agent decide what to read.    |
| **Grouped by directory**         | Makes the manifest scannable for agents.                                                |
| **Includes title**               | Extracted from the first `# ` heading. Gives semantic context without reading the file. |
| **`<system-reminder>` wrapper**  | Signals to the agent that this is system context, not a user request.                   |
| **One-time injection**           | Injected once at registration. The doc list rarely changes during an agent session.     |

---

## Document Discovery

### Files included

| Source                            | Pattern                        | Description                |
| --------------------------------- | ------------------------------ | -------------------------- |
| `<baseDir>/docs/`                 | `**/*.md`, `**/*.mdx`          | All docs directory content |
| `<baseDir>/`                      | `README.md`                    | Root readme                |
| `<baseDir>/apps/*/`               | `README.md` (case-insensitive) | App-level readmes          |
| `<baseDir>/libs/*/`               | `README.md` (case-insensitive) | Library-level readmes      |
| `<baseDir>/tools/*/`              | `README.md` (case-insensitive) | Tool-level readmes         |
| `<baseDir>/.github/instructions/` | `**/*.md`                      | Agent instruction files    |
| `<baseDir>/.github/skills/`       | `**/SKILL.md`                  | Skill definition files     |
| `<baseDir>/.agents/skills/`       | `**/SKILL.md`                  | User-level skill files     |

### Directories skipped

Same as `tools/mcp/config.cjs`:

```
.git, .nx, .vscode, coverage, dist, evidence, evidence-tmp,
node_modules, Pods, tmp, build, out, release, .next, __pycache__
+ simple directory names from .gitignore
```

### Max file size

512 KB (same as `tools/mcp/`). Files larger than this are listed in the manifest but not semantically indexed.

### Max embedding input

First 2000 characters of each file (same as `tools/mcp/`).

---

## Embedding Cache

### Location

`<baseDirectory>/.doc-embeddings.json`

Stored in the repo root so it can be:

- `.gitignore`d (add to the standard gitignore template)
- Shared across agent sessions working on the same repo
- Invalidated naturally when docs change (mtime-based)

### Schema

```typescript
interface DocEmbeddingCache {
  [relativePath: string]: {
    mtime: number; // file mtimeMs at time of embedding
    vector: number[]; // 384-dimensional float array
    title: string | null; // first # heading, or null
  };
}
```

### Invalidation strategy

| Trigger            | Action                                        |
| ------------------ | --------------------------------------------- |
| File mtime changed | Re-embed on next search                       |
| File deleted       | Remove from cache on next save                |
| New file added     | Embed in background, available on next search |
| Cache file missing | Full rebuild (background)                     |

### Background indexing behavior

When `initDocContext` is called:

1. **Immediate** — doc manifest injection uses file titles only (no embedding required, fast).
2. **Background** — `buildCacheBackground()` embeds all uncached/stale files via `setImmediate` batches. This runs without blocking the agent's registration response.
3. **First search** — if a `find_repo_docs` query arrives before background indexing completes, keyword-only results are returned for uncached files. Semantic augmentation only applies to already-cached files.

---

## Implementation Plan

### Phase 1: Core infrastructure

| Step | File                                            | Change                                     |
| ---- | ----------------------------------------------- | ------------------------------------------ |
| 1    | `desktop/package.json`                          | Add `@huggingface/transformers` dependency |
| 2    | `desktop/src/main/doc-indexer.ts`               | Create worker-thread semantic indexer      |
| 3    | `desktop/src/main/doc-context-injector.ts`      | Create doc discovery + manifest injection  |
| 4    | `desktop/src/main/tools/register-connection.ts` | Call `initDocContext` after registration   |

### Phase 2: MCP tool

| Step | File                                       | Change                           |
| ---- | ------------------------------------------ | -------------------------------- |
| 5    | `desktop/src/main/tools/find-repo-docs.ts` | Create `find_repo_docs` MCP tool |
| 6    | `desktop/src/main/mcp-server.ts`           | Register `find_repo_docs` tool   |

### Phase 3: Settings + UI

| Step | File                                              | Change                                             |
| ---- | ------------------------------------------------- | -------------------------------------------------- |
| 7    | `desktop/src/main/settings.ts`                    | Add `docIndexingEnabled` setting (default: `true`) |
| 8    | `desktop/src/renderer/src/pages/SettingsView.tsx` | Add toggle for doc indexing                        |

### Phase 4: Documentation

| Step | File                                | Change                                  |
| ---- | ----------------------------------- | --------------------------------------- |
| 9    | `desktop/docs/TOOLS.md`             | Document `find_repo_docs` tool          |
| 10   | `desktop/docs/DOC-INDEXING-PLAN.md` | Update status to shipped                |
| 11   | `desktop/docs/ARCHITECTURE.md`      | Add doc-indexer to architecture diagram |

---

## Files to touch (summary)

| File                                              | Change                                                            |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| `desktop/package.json`                            | Add `@huggingface/transformers`                                   |
| `desktop/src/main/doc-indexer.ts`                 | **NEW** — worker-thread semantic indexer                          |
| `desktop/src/main/doc-context-injector.ts`        | **NEW** — doc discovery, manifest injection, search orchestration |
| `desktop/src/main/tools/find-repo-docs.ts`        | **NEW** — `find_repo_docs` MCP tool                               |
| `desktop/src/main/tools/register-connection.ts`   | Call `initDocContext` after successful registration               |
| `desktop/src/main/mcp-server.ts`                  | Register `find_repo_docs` tool in `createMcpServerWithTools`      |
| `desktop/src/main/settings.ts`                    | Add `docIndexingEnabled` setting                                  |
| `desktop/src/renderer/src/pages/SettingsView.tsx` | Add doc indexing toggle                                           |
| `desktop/docs/TOOLS.md`                           | Document new tool                                                 |
| `desktop/docs/ARCHITECTURE.md`                    | Update architecture diagram                                       |

---

## Future considerations

### Multi-repo support

If an agent works across multiple repositories (e.g., a monorepo with multiple `baseDirectory` values), each repo gets its own cache file and manifest injection. The `find_repo_docs` tool uses the `baseDirectory` from the agent's registered connection.

### Incremental re-indexing

If the agent session is long-running and docs change during the session, a periodic re-scan (e.g., every 5 minutes) could detect new/changed docs and re-inject an updated manifest. This is a future enhancement — for now, one-time injection at registration is sufficient.

### Migration from `@xenova/transformers` in `tools/mcp/`

After the desktop implementation is stable, migrate `tools/mcp/` from `@xenova/transformers` v2 to `@huggingface/transformers` v3. The API is drop-in compatible; the main change is the import path.
