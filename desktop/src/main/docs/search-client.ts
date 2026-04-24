/**
 * Main-side async proxy for `searchGlobal`, which now lives in the utility
 * process (backed directly by the SQLite DB). See `utility/backend/search.ts`.
 */
import { getUtilitySupervisor } from '../utility/supervisor';
import type {
  GlobalSearchResult,
  SearchOptions,
} from '../utility/backend/search';

export function searchGlobal(
  query: string,
  options: SearchOptions = {},
): Promise<GlobalSearchResult> {
  return getUtilitySupervisor()
    .getBridge()
    .request<GlobalSearchResult>('db.searchGlobal', {
      args: [query, options],
    });
}
