/**
 * Documentation and indexing module barrel file.
 *
 * Re-exports all public APIs from the docs-related modules.
 */

// context-injector.ts
export {
  discoverDocs,
  formatSearchResults,
  initDocContext,
  searchDocs,
  type DocFile,
  type DocSearchResult,
} from './context-injector';

// indexer.ts
export {
  buildFullCache,
  DOC_MAX_FILE_SIZE,
  embedText,
  extractTitle,
  findSemantic,
  isReady,
  loadCache,
  saveCache,
  SEMANTIC_THRESHOLD,
  SEMANTIC_WEIGHT,
  shutdown,
  warmUp,
  type DocEmbeddingCache,
  type DocEmbeddingEntry,
  type SemanticHit,
} from './indexer';

// inject-handler.ts
export {
  handleInjectDocContext,
  type InjectDocContextDeps,
  type InjectDocContextInput,
  type InjectDocContextResult,
} from './inject-handler';

// file-indexer.ts
export { indexFiles, rankFileSuggestions } from './file-indexer';

// search.ts
export {
  searchGlobal,
  type GlobalSearchResult,
  type MessageSearchResult,
  type SearchOptions,
  type SessionSearchResult,
} from './search';
