export interface PersistedChannel {
  sessionId: string;
  label: string | null;
  openCodeSessionId: string | null;
}

function isGenericAgentLabel(label: string | null): boolean {
  return !!label && /^Agent \d+$/.test(label);
}

export function findStaleGenericDirectChannels(
  channels: PersistedChannel[],
  activeConnectionIds: Set<string>,
  currentConnectionId: string,
): string[] {
  return channels
    .filter((channel) => channel.sessionId !== currentConnectionId)
    .filter((channel) => channel.openCodeSessionId === null)
    .filter((channel) => isGenericAgentLabel(channel.label))
    .filter((channel) => !activeConnectionIds.has(channel.sessionId))
    .map((channel) => channel.sessionId);
}
