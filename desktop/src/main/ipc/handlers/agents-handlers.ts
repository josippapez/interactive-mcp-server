import { ipcMain } from 'electron';
import {
  listAgents,
  readAgent,
  writeAgent,
  deleteAgent,
  type AgentDefinition,
  type WriteAgentParams,
} from '../../utility/opencode-client';
import { logIpcInfo } from './shared';
import { IpcHandlerDeps } from './types';
import { errorMessage } from '../../utils/errors';

type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function registerAgentsHandlers(deps: IpcHandlerDeps): void {
  ipcMain.handle(
    'list-agents',
    async (
      _event,
      baseDirectory?: string,
    ): Promise<IpcResult<AgentDefinition[]>> => {
      try {
        logIpcInfo(`list-agents: baseDirectory=${baseDirectory ?? '<none>'}`);
        const settings = deps.getSettings();
        const data = await listAgents(settings.openCodePort, baseDirectory);
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    'read-agent',
    async (
      _event,
      filePath: string,
    ): Promise<IpcResult<AgentDefinition | null>> => {
      try {
        const data = await readAgent(filePath);
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    'write-agent',
    async (
      _event,
      params: WriteAgentParams,
    ): Promise<IpcResult<{ filePath: string }>> => {
      try {
        logIpcInfo(`write-agent: scope=${params.scope} name=${params.name}`);
        const data = await writeAgent(params);
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    'delete-agent',
    async (_event, filePath: string): Promise<IpcResult<null>> => {
      try {
        logIpcInfo(`delete-agent: ${filePath}`);
        await deleteAgent(filePath);
        return { ok: true, data: null };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );
}
