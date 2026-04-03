import { useState, useCallback, useEffect, useRef } from 'react';
import type { Attachment, ChannelMessage, ConnectionState } from '../types';

type SessionStatusType = 'info' | 'working' | 'success' | 'error';

function createBaseConnection(
  id: string,
  name: string,
  sessionChannel: { sessionId: string; label?: string } | null,
  isRestored = false,
  openCodeSessionId?: string | null,
  parentSessionId?: string | null,
): ConnectionState {
  return {
    id,
    name,
    prompt: null,
    activeSession: null,
    channelMessages: [],
    unreadCount: 0,
    hasPendingPrompt: false,
    sessionChannel,
    sessionStatuses: [],
    isRestored,
    openCodeSessionId: openCodeSessionId ?? undefined,
    parentSessionId: parentSessionId ?? undefined,
  };
}

function parseHistoryTimestamp(value: string): Date {
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const parsed = new Date(
    normalized.endsWith('Z') ? normalized : `${normalized}Z`,
  );
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function parseAttachments(
  raw: string | null,
):
  | { data: string; mimeType: string; name: string; size: number }[]
  | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter(Boolean) as {
      data: string;
      mimeType: string;
      name: string;
      size: number;
    }[];
  } catch {
    return undefined;
  }
}

function toChannelMessage(record: {
  id: number;
  messageType: 'question' | 'answer' | 'outbound' | 'agent_message';
  messageText: string;
  attachments: string | null;
  createdAt: string;
}): ChannelMessage {
  return {
    id: `db-${record.id}`,
    kind: record.messageType,
    text: record.messageText,
    timestamp: parseHistoryTimestamp(record.createdAt),
    attachments: parseAttachments(record.attachments),
  };
}

export function useConnections(onActivatePromptTab: () => void) {
  const [connections, setConnections] = useState<Map<string, ConnectionState>>(
    new Map(),
  );
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(
    null,
  );
  const [clientInfo, setClientInfo] = useState<
    { model?: string; mode?: string } | undefined
  >();
  const listenersRegistered = useRef(false);
  const activateRef = useRef(onActivatePromptTab);
  activateRef.current = onActivatePromptTab;
  const activeConnectionRef = useRef<string | null>(null);
  activeConnectionRef.current = activeConnectionId;
  const pendingRegistrations = useRef(
    new Map<
      string,
      {
        agentName: string;
        openCodeSessionId: string | null;
        parentSessionId: string | null;
      }
    >(),
  );

  const withConnection = useCallback(
    (
      connectionId: string,
      updater: (conn: ConnectionState) => ConnectionState,
    ) => {
      setConnections((prev) => {
        const conn = prev.get(connectionId);
        if (!conn) return prev;
        const next = new Map(prev);
        next.set(connectionId, updater(conn));
        return next;
      });
    },
    [],
  );

  const loadChannelHistory = useCallback(async (connectionId: string) => {
    const records = await window.api.getSessionChannelHistory?.(connectionId);
    if (!records) return;
    setConnections((prev) => {
      const conn = prev.get(connectionId);
      if (!conn) return prev;
      const dbMessages = records.map(toChannelMessage);
      // Merge: keep live messages that are not already covered by a DB record.
      // A live message is considered a duplicate if a DB record shares the same
      // kind and text (DB records are the authoritative persisted version).
      const liveIds = new Set(dbMessages.map((m) => `${m.kind}::${m.text}`));
      const dedupedLive = conn.channelMessages.filter(
        (m) => !liveIds.has(`${m.kind}::${m.text}`),
      );
      const merged = [...dbMessages, ...dedupedLive].sort(
        (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
      );
      const next = new Map(prev);
      next.set(connectionId, { ...conn, channelMessages: merged });
      return next;
    });
  }, []);

  useEffect(() => {
    if (activeConnectionId) {
      withConnection(activeConnectionId, (conn) => ({
        ...conn,
        unreadCount: 0,
      }));
    }
  }, [activeConnectionId, withConnection]);

  useEffect(() => {
    if (listenersRegistered.current) return;
    listenersRegistered.current = true;

    const pushMessage = (
      connectionId: string,
      message: Omit<ChannelMessage, 'id'>,
    ): void => {
      withConnection(connectionId, (conn) => ({
        ...conn,
        channelMessages: [
          ...conn.channelMessages,
          {
            ...message,
            id: `live-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          },
        ],
        unreadCount:
          activeConnectionRef.current === connectionId
            ? conn.unreadCount
            : conn.unreadCount + 1,
      }));
    };

    void window.api.getSettings().then((settings) => {
      if (!settings.autoRestoreSessions) return;
      void window.api.getPersistedSessionChannels?.().then((channels) => {
        if (channels.length === 0) return;
        setConnections((prev) => {
          const next = new Map(prev);
          for (const ch of channels) {
            if (!next.has(ch.sessionId)) {
              next.set(
                ch.sessionId,
                createBaseConnection(
                  ch.sessionId,
                  ch.label ?? 'Restored session',
                  { sessionId: ch.sessionId, label: ch.label ?? undefined },
                  true,
                  ch.openCodeSessionId,
                  ch.parentSessionId,
                ),
              );
            }
          }
          return next;
        });
        const first = channels[0]?.sessionId ?? null;
        setActiveConnectionId((prev) => prev ?? first);
        for (const ch of channels) {
          void loadChannelHistory(ch.sessionId);
        }
      });
    });

    window.api.onConnectionOpened?.((data) => {
      setConnections((prev) => {
        const next = new Map(prev);
        // Find and remove any restored entry with the same name.
        // Capture its data so we can carry over openCodeSessionId / parentSessionId.
        let restoredBase: ConnectionState | undefined;
        for (const [id, conn] of next) {
          if (conn.isRestored && conn.name === data.name) {
            restoredBase = conn;
            next.delete(id);
          }
        }
        const existing = next.get(data.connectionId);
        const base: ConnectionState = {
          ...(existing ??
            restoredBase ??
            createBaseConnection(
              data.connectionId,
              data.name,
              data.sessionId
                ? { sessionId: data.sessionId, label: data.label }
                : null,
            )),
          id: data.connectionId,
          name: data.name,
          isRestored: false,
          sessionChannel: data.sessionId
            ? { sessionId: data.sessionId, label: data.label }
            : (existing?.sessionChannel ??
              restoredBase?.sessionChannel ??
              null),
        };
        // Apply any registration data that arrived before connection-opened
        const pending = pendingRegistrations.current.get(data.connectionId);
        if (pending) {
          pendingRegistrations.current.delete(data.connectionId);
          next.set(data.connectionId, {
            ...base,
            name: pending.agentName,
            openCodeSessionId:
              pending.openCodeSessionId ?? base.openCodeSessionId,
            parentSessionId: pending.parentSessionId ?? base.parentSessionId,
          });
        } else {
          next.set(data.connectionId, base);
        }
        return next;
      });
      setActiveConnectionId((prev) => prev ?? data.connectionId);
      void loadChannelHistory(data.connectionId);
      activateRef.current();
    });

    window.api.onConnectionRegistered?.((data) => {
      // Check if connection is already in the map before attempting update.
      // We read connections via setConnections to avoid stale closure, but we
      // also need to decide whether to stash for pending-registration. Use a
      // ref-backed flag that is set inside the updater so it survives StrictMode
      // double-invocations (the last call wins, which is correct).
      const appliedRef = { value: false };
      setConnections((prev) => {
        const conn = prev.get(data.connectionId);
        const next = new Map(prev);

        // Remove any placeholder entry whose id matches this openCodeSessionId.
        // The poller pre-created it; now the real connection has registered.
        if (data.openCodeSessionId && next.has(data.openCodeSessionId)) {
          const placeholder = next.get(data.openCodeSessionId);
          if (placeholder?.isPlaceholder) {
            next.delete(data.openCodeSessionId);
          }
        }

        // If a restored connection with the same name exists, clear its
        // isRestored flag — the agent has reconnected via register_connection
        // (which only fires connection-registered, not connection-opened).
        for (const [id, restoredConn] of next) {
          if (restoredConn.isRestored && restoredConn.name === data.agentName) {
            next.set(id, {
              ...restoredConn,
              isRestored: false,
              openCodeSessionId:
                data.openCodeSessionId ?? restoredConn.openCodeSessionId,
              parentSessionId:
                data.parentSessionId ?? restoredConn.parentSessionId,
            });
            appliedRef.value = true;
            return next;
          }
        }

        if (!conn) {
          appliedRef.value = false;
          return next.size !== prev.size ? next : prev;
        }
        appliedRef.value = true;
        next.set(data.connectionId, {
          ...conn,
          name: data.agentName,
          openCodeSessionId: data.openCodeSessionId,
          parentSessionId: data.parentSessionId,
        });
        return next;
      });
      // If connection isn't in the map yet (race: registered before opened),
      // stash it so onConnectionOpened can apply it when the connection arrives.
      if (!appliedRef.value) {
        pendingRegistrations.current.set(data.connectionId, {
          agentName: data.agentName,
          openCodeSessionId: data.openCodeSessionId,
          parentSessionId: data.parentSessionId,
        });
      }
    });

    window.api.onConnectionClosed?.((data) => {
      let remainingIds: string[] = [];
      setConnections((prev) => {
        const next = new Map(prev);
        next.delete(data.connectionId);
        remainingIds = Array.from(next.keys());
        return next;
      });
      setActiveConnectionId((prev) => {
        if (prev !== data.connectionId) return prev;
        return remainingIds.length > 0 ? remainingIds[0] : null;
      });
    });

    window.api.onPromptRequest((data) => {
      if (data.clientInfo) setClientInfo(data.clientInfo);
      withConnection(data.connectionId, (conn) => ({
        ...conn,
        prompt: data,
        hasPendingPrompt: true,
        baseDirectory: data.baseDirectory ?? conn.baseDirectory,
      }));
      pushMessage(data.connectionId, {
        kind: 'question',
        text: data.message,
        timestamp: new Date(),
      });
      setActiveConnectionId((prev) => prev ?? data.connectionId);
      activateRef.current();
    });

    window.api.onIntensiveChatStart?.((data) => {
      withConnection(data.connectionId, (conn) => ({
        ...conn,
        activeSession: { id: data.sessionId, title: data.title },
      }));
      setActiveConnectionId((prev) => prev ?? data.connectionId);
      activateRef.current();
    });

    window.api.onIntensiveChatStop?.((data) => {
      withConnection(data.connectionId, (conn) => ({
        ...conn,
        activeSession: null,
      }));
    });

    window.api.onSessionStatusUpdate?.((data) => {
      withConnection(data.connectionId, (conn) => ({
        ...conn,
        sessionStatuses: [
          ...conn.sessionStatuses,
          {
            status: data.status,
            type: data.type as SessionStatusType,
            timestamp: new Date(),
          },
        ],
      }));
    });

    window.api.onSessionChannelCreated?.((data) => {
      setConnections((prev) => {
        if (prev.size === 0) return prev;
        for (const conn of prev.values()) {
          if (conn.sessionChannel?.sessionId === data.sessionId) return prev;
        }
        const next = new Map(prev);
        const targetId =
          Array.from(prev.keys()).find(
            (id) => prev.get(id)?.sessionChannel === null,
          ) ?? data.sessionId;
        const existing = next.get(targetId);
        next.set(
          targetId,
          existing
            ? {
                ...existing,
                sessionChannel: {
                  sessionId: data.sessionId,
                  label: data.label,
                },
              }
            : createBaseConnection(targetId, data.label ?? targetId, {
                sessionId: data.sessionId,
                label: data.label,
              }),
        );
        return next;
      });
      void loadChannelHistory(data.sessionId);
      activateRef.current();
    });

    window.api.onSessionChannelDeleted?.((data) => {
      setConnections((prev) => {
        const next = new Map(prev);
        next.delete(data.sessionId);
        return next;
      });
      setActiveConnectionId((prev) => (prev === data.sessionId ? null : prev));
    });

    window.api.onSessionChannelMessagesCleared?.((data) => {
      withConnection(data.sessionId, (conn) => ({
        ...conn,
        channelMessages: [],
        unreadCount: 0,
      }));
    });

    // Pre-create placeholder sidebar entries for subagent sessions detected by
    // the session-tree poller before the agent calls register_connection.
    window.api.onChildSessionsDetected?.((children) => {
      setConnections((prev) => {
        // Build a lookup: openCodeSessionId → connectionId for existing entries
        const byOpenCodeId = new Map<string, string>();
        for (const conn of prev.values()) {
          if (conn.openCodeSessionId) {
            byOpenCodeId.set(conn.openCodeSessionId, conn.id);
          }
        }

        let changed = false;
        const next = new Map(prev);

        for (const child of children) {
          // Skip if already tracked (either as real connection or placeholder)
          if (byOpenCodeId.has(child.openCodeSessionId)) continue;

          changed = true;
          const placeholderId = child.openCodeSessionId;
          next.set(placeholderId, {
            id: placeholderId,
            name: 'Subagent (connecting\u2026)',
            prompt: null,
            activeSession: null,
            channelMessages: [],
            unreadCount: 0,
            hasPendingPrompt: false,
            sessionChannel: null,
            sessionStatuses: [],
            openCodeSessionId: child.openCodeSessionId,
            parentSessionId: child.parentOpenCodeSessionId,
            isPlaceholder: true,
          });
        }

        return changed ? next : prev;
      });
    });

    window.api.onAgentMessage?.((data) => {
      pushMessage(data.connectionId, {
        kind: 'agent_message',
        text: data.message,
        timestamp: new Date(),
      });
    });
  }, [loadChannelHistory, withConnection]);

  useEffect(() => {
    if (activeConnectionId !== null && connections.has(activeConnectionId))
      return;
    const first = connections.keys().next().value as string | undefined;
    setActiveConnectionId(first ?? null);
  }, [connections, activeConnectionId]);

  const activeConn = activeConnectionId
    ? (connections.get(activeConnectionId) ?? null)
    : null;

  const handleDismissStatus = useCallback(
    (connectionId: string, timestamp: Date) => {
      withConnection(connectionId, (conn) => ({
        ...conn,
        sessionStatuses: conn.sessionStatuses.filter(
          (s) => s.timestamp !== timestamp,
        ),
      }));
    },
    [withConnection],
  );

  const appendAnswerMessage = useCallback(
    (connectionId: string, text: string, attachments?: Attachment[]) => {
      withConnection(connectionId, (conn) => ({
        ...conn,
        channelMessages: [
          ...conn.channelMessages,
          {
            id: `local-answer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            kind: 'answer',
            text,
            timestamp: new Date(),
            attachments,
          },
        ],
        prompt: null,
        hasPendingPrompt: false,
      }));
    },
    [withConnection],
  );

  const handleSubmit = useCallback(
    (answer: string, attachments?: Attachment[]) => {
      if (!activeConn?.prompt) return;
      const { prompt } = activeConn;
      appendAnswerMessage(activeConn.id, answer, attachments);
      window.api.sendPromptResponse({
        id: prompt.id,
        answer,
        attachments: attachments?.length ? attachments : undefined,
      });
    },
    [activeConn, appendAnswerMessage],
  );

  const handleSelectOption = useCallback(
    (option: string) => {
      if (!activeConn?.prompt) return;
      const { prompt } = activeConn;
      appendAnswerMessage(activeConn.id, option);
      window.api.sendPromptResponse({ id: prompt.id, answer: option });
    },
    [activeConn, appendAnswerMessage],
  );

  const handleDismissSession = useCallback((connectionId: string) => {
    void window.api.dismissSession?.(connectionId);
  }, []);

  const handleQueueSessionMessage = useCallback(
    (sessionId: string, message: string, attachments?: Attachment[]) => {
      const outboundId = `local-outbound-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Always queue in SQLite for VS Code extension polling
      window.api.queueSessionMessage(sessionId, message);
      withConnection(sessionId, (conn) => ({
        ...conn,
        channelMessages: [
          ...conn.channelMessages,
          {
            id: outboundId,
            kind: 'outbound' as const,
            text: message,
            timestamp: new Date(),
            attachments,
          },
        ],
      }));

      // Resolve OpenCode session: use cached value or detect on demand.
      const conn = connections.get(sessionId);
      const baseDirectory = conn?.baseDirectory;

      const resolveAndInject = async (): Promise<void> => {
        let openCodeSessionId = conn?.openCodeSessionId ?? null;

        // Lazy detection: if no cached session ID, try to detect now.
        if (!openCodeSessionId) {
          openCodeSessionId =
            (await window.api.detectOpenCodeSession?.(baseDirectory)) ?? null;
          if (openCodeSessionId) {
            // Cache the detected session ID so subsequent sends are instant.
            withConnection(sessionId, (c) => ({
              ...c,
              openCodeSessionId,
            }));
          }
        }

        if (!openCodeSessionId) {
          // No OpenCode session available — SQLite queue is the delivery mechanism.
          // Mark as sent immediately so the UI doesn't show "Queued" forever.
          withConnection(sessionId, (c) => ({
            ...c,
            channelMessages: c.channelMessages.map((m) =>
              m.id === outboundId ? { ...m, sent: true } : m,
            ),
          }));
          return;
        }

        try {
          const result = await window.api.injectOpenCodeMessage?.(
            openCodeSessionId,
            message,
            attachments,
          );
          if (result?.ok) {
            withConnection(sessionId, (c) => ({
              ...c,
              channelMessages: c.channelMessages.map((m) =>
                m.id === outboundId ? { ...m, sent: true } : m,
              ),
            }));
            return;
          }
          withConnection(sessionId, (c) => ({
            ...c,
            sessionStatuses: [
              ...c.sessionStatuses,
              {
                status: `OpenCode inject failed: ${result?.error ?? 'unknown error'}`,
                type: 'error' as const,
                timestamp: new Date(),
              },
            ],
          }));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          withConnection(sessionId, (c) => ({
            ...c,
            sessionStatuses: [
              ...c.sessionStatuses,
              {
                status: `OpenCode inject error: ${msg}`,
                type: 'error' as const,
                timestamp: new Date(),
              },
            ],
          }));
        }
      };

      void resolveAndInject();
    },
    [connections, withConnection],
  );

  const handleClearChannelMessages = useCallback((sessionId: string) => {
    void window.api.clearSessionChannelMessages(sessionId);
  }, []);

  const handleRemoveSession = useCallback((sessionId: string) => {
    void window.api.removeSessionChannel(sessionId);
  }, []);

  return {
    connections,
    activeConnectionId,
    setActiveConnectionId,
    activeConn,
    clientInfo,
    handleSubmit,
    handleSelectOption,
    handleDismissStatus,
    handleDismissSession,
    handleQueueSessionMessage,
    handleClearChannelMessages,
    handleRemoveSession,
  };
}
