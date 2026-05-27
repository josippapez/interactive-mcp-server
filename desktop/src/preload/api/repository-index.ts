import { ipcRenderer } from 'electron';
import type {
  RepositoryIndexStatusPayload,
  RepositoryIndexSummary,
} from './types';

type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function createRepositoryIndexApi() {
  return {
    fetchRepositoryIndexStatus: (
      baseDirectory: string,
    ): Promise<IpcResult<RepositoryIndexStatusPayload>> =>
      ipcRenderer.invoke('repository-index-status', baseDirectory),

    fetchRepositoryIndexStatusForSession: (
      providerSessionId: string,
    ): Promise<IpcResult<RepositoryIndexStatusPayload>> =>
      ipcRenderer.invoke(
        'repository-index-status-for-session',
        providerSessionId,
      ),

    startRepositoryIndex: (
      baseDirectory: string | null,
      options?: { watch?: boolean; providerSessionId?: string | null },
    ): Promise<IpcResult<RepositoryIndexSummary>> =>
      ipcRenderer.invoke('repository-index-start', {
        baseDirectory,
        providerSessionId: options?.providerSessionId,
        watch: options?.watch,
      }),

    stopRepositoryIndexWatcher: (
      baseDirectory: string,
    ): Promise<IpcResult<{ repositoryRoot: string; stopped: boolean }>> =>
      ipcRenderer.invoke('repository-index-stop-watcher', baseDirectory),
  };
}
