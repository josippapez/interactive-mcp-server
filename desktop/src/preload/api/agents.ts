import { ipcRenderer } from 'electron';
import type { AgentDefinition } from './types';

export function createAgentsApi() {
  return {
    /**
     * List all OpenCode custom agents (global + project-scoped for baseDirectory).
     * Returns project-scoped agents first, then globals. Globals with the same
     * name as a project agent are marked `overridden: true`.
     */
    listAgents: (
      baseDirectory?: string,
    ): Promise<
      { ok: true; data: AgentDefinition[] } | { ok: false; error: string }
    > => ipcRenderer.invoke('list-agents', baseDirectory),

    /**
     * Read a single agent by absolute file path. Returns null if missing.
     */
    readAgent: (
      filePath: string,
    ): Promise<
      { ok: true; data: AgentDefinition | null } | { ok: false; error: string }
    > => ipcRenderer.invoke('read-agent', filePath),

    /**
     * Create or overwrite an agent file.
     * scope='global' → ~/.config/opencode/agent/<name>.md
     * scope='project' → <baseDirectory>/.opencode/agent/<name>.md (baseDirectory required)
     */
    writeAgent: (params: {
      scope: 'global' | 'project';
      baseDirectory?: string;
      name: string;
      description: string;
      mode: string;
      tools: Record<string, boolean>;
      model?: string;
      body: string;
    }): Promise<
      { ok: true; data: { filePath: string } } | { ok: false; error: string }
    > => ipcRenderer.invoke('write-agent', params),

    /**
     * Delete the agent file at the given absolute path. Rejects paths outside
     * the known agent directories.
     */
    deleteAgent: (
      filePath: string,
    ): Promise<{ ok: true; data: null } | { ok: false; error: string }> =>
      ipcRenderer.invoke('delete-agent', filePath),
  };
}
