import type { BrowserWindow } from 'electron';
import {
  forwardConversationEvent,
  forwardPermissionEvent,
  forwardQuestionEvent,
  forwardSessionEvent,
} from './bus-event-forwarders';
import type { BusEventHandlerDependencies } from './bus-event-utils';
import { createLogger } from '../utils/logger';

interface BusEventEnvelope {
  directory?: string;
  payload: {
    type: string;
    properties: Record<string, unknown>;
  };
}

const sseLog = createLogger('sse');

function sendToWindow(
  win: BrowserWindow,
  channel: string,
  data: unknown,
): void {
  if (win.isDestroyed()) return;
  win.webContents.send(channel, data);
}

export function handleBusEvent(
  envelope: unknown,
  win: BrowserWindow | null,
  dependencies: BusEventHandlerDependencies = {},
): void {
  if (!envelope || typeof envelope !== 'object' || !win) return;

  const env = envelope as Partial<BusEventEnvelope>;
  const payload = env.payload;
  if (!payload?.type || !payload.properties) return;

  const { type, properties } = payload;
  sseLog.debug(`Event received: ${type}`);

  if (forwardPermissionEvent(type, properties, env.directory, win, dependencies)) {
    return;
  }

  if (forwardQuestionEvent(type, properties, win)) {
    return;
  }

  if (forwardSessionEvent(type, properties, win)) {
    return;
  }

  if (forwardConversationEvent(type, properties, win)) {
    return;
  }
}
