import type { SessionNode } from '../../types';

export type PersistedSessionChannel = {
  sessionId: string;
  label: string | null;
  createdAt: string;
  providerSessionId: string | null;
  parentSessionId: string | null;
};

type HydratePersistedSessionChannelsOptions = {
  includeMissing?: boolean;
};

function createPersistedSessionNode(
  channel: PersistedSessionChannel,
  fallback?: SessionNode,
): SessionNode {
  const providerSessionId = channel.providerSessionId ?? channel.sessionId;
  const title = fallback?.title || channel.label?.trim() || 'Session';
  const createdAt = Date.parse(channel.createdAt);

  return {
    id: providerSessionId,
    providerSessionId,
    openCodeParentId: channel.parentSessionId,
    title,
    directory: fallback?.directory ?? '',
    createdAt: Number.isFinite(createdAt) ? createdAt : fallback?.createdAt,
    depth: fallback?.depth ?? 0,
    connectionId: fallback?.connectionId ?? null,
    hasMcpChannel: true,
    isDirectConnection: false,
    providerType: fallback?.providerType ?? 'opencode',
    prompt: fallback?.prompt ?? null,
    activeSession: fallback?.activeSession ?? null,
    baseDirectory: fallback?.baseDirectory ?? null,
    channelMessages: fallback?.channelMessages ?? [],
    unreadCount: fallback?.unreadCount ?? 0,
    lastReadMessageId: fallback?.lastReadMessageId ?? null,
    hasPendingPrompt: fallback?.hasPendingPrompt ?? false,
    sessionChannel: {
      sessionId: channel.sessionId,
      label: channel.label ?? fallback?.sessionChannel?.label,
    },
    sessionStatuses: fallback?.sessionStatuses ?? [],
    pendingPermissions: fallback?.pendingPermissions ?? [],
    pendingQuestions: fallback?.pendingQuestions ?? [],
    docContextEnabled: fallback?.docContextEnabled,
    vcsInfo: fallback?.vcsInfo ?? null,
  };
}

export function hydratePersistedSessionChannels(
  prev: Map<string, SessionNode>,
  channels: PersistedSessionChannel[],
  options: HydratePersistedSessionChannelsOptions = {},
): Map<string, SessionNode> {
  if (channels.length === 0) {
    return prev;
  }

  const next = new Map(prev);

  for (const channel of channels) {
    const nodeKey = channel.providerSessionId ?? channel.sessionId;
    const existing =
      next.get(nodeKey) ??
      next.get(channel.sessionId) ??
      Array.from(next.values()).find(
        (node) =>
          node.providerSessionId === channel.providerSessionId ||
          node.sessionChannel?.sessionId === channel.sessionId,
      );

    if (!existing && !options.includeMissing) {
      continue;
    }

    next.set(nodeKey, createPersistedSessionNode(channel, existing));
  }

  return next;
}
