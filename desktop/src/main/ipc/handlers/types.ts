import { BrowserWindow } from 'electron';
import { AppSettings } from '../../settings';

export interface IpcHandlerDeps {
  getMainWindow: () => BrowserWindow | null;
  getSettings: () => AppSettings;
  setSettings: (settings: AppSettings) => void;
  /**
   * Returns actually-bound ports tracked separately from `getSettings()`.
   * `null` means the resolver hasn't run yet — caller should fall back to
   * the requested value. Set by the bootstrap in `main/index.ts` after
   * `startMcpServer` / `startOpenCodeServer` resolve.
   */
  getResolvedPorts: () => { mcp: number | null; openCode: number | null };
  /**
   * Updates the in-memory resolved-port holder. Called by handlers that
   * restart MCP/OpenCode (e.g. `save-settings`) so the renderer's
   * `get-resolved-ports` query reflects the newly bound port.
   */
  setResolvedPort: (kind: 'mcp' | 'openCode', port: number | null) => void;
}

export interface AttachmentPayload {
  data: string;
  mimeType: string;
  name: string;
  size: number;
}

export interface ModelSelectionPayload {
  providerId: string;
  modelId: string;
  variant?: string;
}
