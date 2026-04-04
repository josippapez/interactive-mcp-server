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
  clearAllSessions: (() => Promise<number>) | null;
}

export function createApiRouter(deps: ApiRouterDeps): Router {
  const router = Router();

  // Soft-restart endpoint — clears all in-memory MCP sessions but keeps the
  // HTTP listener running so clients can transparently reinitialize.
  router.post('/api/reconnect', async (_req, res) => {
    if (!deps.clearAllSessions) {
      res.json({ ok: false, cleared: 0, message: 'Server not initialized.' });
      return;
    }
    try {
      const cleared = await deps.clearAllSessions();
      res.json({
        ok: true,
        cleared,
        message: `Cleared ${cleared} session(s). Clients will reinitialize on next request.`,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        cleared: 0,
        message: `Reconnect failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
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
