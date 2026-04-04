import { Router } from 'express';
import type { BrowserWindow } from 'electron';
import {
  createSessionChannel,
  getUnsentMessages,
  getUnsentCount,
  markMessagesSent,
  deleteSessionChannel,
} from './database';

export interface ApiRouterDeps {
  getWindow: () => BrowserWindow | null;
}

export function createApiRouter(deps: ApiRouterDeps): Router {
  const router = Router();

  // Force-reconnect endpoint — clears all in-memory sessions so clients reinitialize on next call
  router.post('/api/reconnect', (_req, res) => {
    res.json({
      ok: true,
      cleared: 0,
      message:
        'Reconnect endpoint acknowledged. Use restart server for full reset.',
    });
  });

  // Create a session channel
  router.post('/api/sessions', (req, res) => {
    const { sessionId, label } = req.body as {
      sessionId?: string;
      label?: string;
    };
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId required' });
      return;
    }
    createSessionChannel(sessionId, label);
    deps.getWindow()?.webContents.send('session-channel-created', {
      sessionId,
      label,
    });
    res.json({ ok: true, sessionId });
  });

  // Count unsent messages without consuming them (used by extension for peek)
  router.get('/api/sessions/:sessionId/messages/count', (req, res) => {
    const { sessionId } = req.params;
    const count = getUnsentCount(sessionId);
    res.json({ count });
  });

  // Get unsent messages for a session (and mark them sent)
  router.get('/api/sessions/:sessionId/messages', (req, res) => {
    const { sessionId } = req.params;
    const messages = getUnsentMessages(sessionId);
    if (messages.length > 0) {
      markMessagesSent(messages.map((m) => m.id));
    }
    res.json({ messages });
  });

  // Delete / cleanup a session channel
  router.delete('/api/sessions/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    deleteSessionChannel(sessionId);
    deps
      .getWindow()
      ?.webContents.send('session-channel-deleted', { sessionId });
    res.json({ ok: true });
  });

  return router;
}
