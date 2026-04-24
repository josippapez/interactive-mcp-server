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

// inject-handler.ts
export {
  handleInjectDocContext,
  type InjectDocContextDeps,
  type InjectDocContextInput,
  type InjectDocContextResult,
} from './inject-handler';

// file-indexer.ts
export { indexFiles, rankFileSuggestions } from './file-indexer';

// search.ts — moved to utility/backend; re-export async proxy from main-side
// docs/search-client.ts and types from the moved module.
export { searchGlobal } from './search-client';
export type {
  GlobalSearchResult,
  MessageSearchResult,
  SearchOptions,
  SessionSearchResult,
} from '../utility/backend/search';
