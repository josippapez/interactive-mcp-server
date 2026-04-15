import { BrowserWindow } from 'electron';
import { AppSettings } from '../../settings';

export interface IpcHandlerDeps {
  getMainWindow: () => BrowserWindow | null;
  getSettings: () => AppSettings;
  setSettings: (settings: AppSettings) => void;
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
