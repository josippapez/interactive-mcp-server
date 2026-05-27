import { ipcMain } from 'electron';
import {
  fetchRepositoryIndexStatus,
  fetchRepositoryIndexStatusForSession,
  startRepositoryIndex,
  startRepositoryIndexForSession,
  stopRepositoryIndexWatcher,
} from '../../utility/repository-index-client';
import { withIpcResult } from './ipc-result';
import { IpcHandlerDeps } from './types';

export function registerRepositoryIndexHandlers(deps: IpcHandlerDeps): void {
  ipcMain.handle(
    'repository-index-status',
    withIpcResult(async (_event, baseDirectory: string) => {
      if (!deps.getSettings().docIndexingEnabled) {
        return {
          repositoryRoot: baseDirectory,
          index: null,
          watchedRepositoryRoots: [],
          disabled: true,
        };
      }
      return fetchRepositoryIndexStatus(baseDirectory);
    }),
  );

  ipcMain.handle(
    'repository-index-start',
    withIpcResult(
      async (
        _event,
        payload: {
          baseDirectory?: string | null;
          providerSessionId?: string | null;
          watch?: boolean;
        },
      ) => {
        if (!deps.getSettings().docIndexingEnabled) {
          throw new Error('Repository indexing is disabled in settings.');
        }
        if (payload.baseDirectory) {
          return startRepositoryIndex(
            payload.baseDirectory,
            payload.watch ?? true,
          );
        }
        if (payload.providerSessionId) {
          return startRepositoryIndexForSession(
            payload.providerSessionId,
            payload.watch ?? true,
          );
        }
        throw new Error(
          'Repository indexing needs a baseDirectory or providerSessionId.',
        );
      },
    ),
  );

  ipcMain.handle(
    'repository-index-status-for-session',
    withIpcResult(async (_event, providerSessionId: string) => {
      if (!deps.getSettings().docIndexingEnabled) {
        return {
          repositoryRoot: '',
          index: null,
          watchedRepositoryRoots: [],
          disabled: true,
        };
      }
      return fetchRepositoryIndexStatusForSession(providerSessionId);
    }),
  );

  ipcMain.handle(
    'repository-index-stop-watcher',
    withIpcResult(async (_event, baseDirectory: string) => {
      return stopRepositoryIndexWatcher(baseDirectory);
    }),
  );
}
