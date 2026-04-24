export interface SessionRegistrationEntry {
  connectionId: string;
  connectionName: string;
  isRegistered: boolean;
}

function isDefaultAgentName(name: string): boolean {
  return /^Agent \d+$/.test(name);
}

export function pickUnregisteredConnectionsForCleanup(
  entries: SessionRegistrationEntry[],
  justRegistered: { connectionId: string; channelName: string },
): string[] {
  return entries
    .filter((entry) => entry.connectionId !== justRegistered.connectionId)
    .filter(
      (entry) =>
        !entry.isRegistered &&
        (isDefaultAgentName(entry.connectionName) ||
          entry.connectionName === justRegistered.channelName),
    )
    .map((entry) => entry.connectionId);
}

export function pickUnregisteredDefaultConnectionsForCleanup(
  entries: SessionRegistrationEntry[],
  justRegisteredConnectionId: string,
): string[] {
  return pickUnregisteredConnectionsForCleanup(entries, {
    connectionId: justRegisteredConnectionId,
    channelName: '',
  }).filter((connectionId) => {
    const entry = entries.find((e) => e.connectionId === connectionId);
    return !!entry && isDefaultAgentName(entry.connectionName);
  });
}
