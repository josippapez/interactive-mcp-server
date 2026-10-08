export function openSubagentSessionTab(
  sessionIds: readonly string[],
  sessionId: string,
): string[] {
  if (sessionIds.includes(sessionId)) {
    return [...sessionIds];
  }

  return [...sessionIds, sessionId];
}

export function closeSubagentSessionTab(
  sessionIds: readonly string[],
  activeSessionId: string | null,
  closingSessionId: string,
): { sessionIds: string[]; activeSessionId: string | null } {
  const closingIndex = sessionIds.indexOf(closingSessionId);
  if (closingIndex === -1) {
    return {
      sessionIds: [...sessionIds],
      activeSessionId,
    };
  }

  const nextSessionIds = sessionIds.filter((id) => id !== closingSessionId);
  if (activeSessionId !== closingSessionId) {
    return {
      sessionIds: nextSessionIds,
      activeSessionId:
        activeSessionId && nextSessionIds.includes(activeSessionId)
          ? activeSessionId
          : (nextSessionIds.at(-1) ?? null),
    };
  }

  return {
    sessionIds: nextSessionIds,
    activeSessionId:
      nextSessionIds[closingIndex] ?? nextSessionIds[closingIndex - 1] ?? null,
  };
}

export function pruneSubagentSessionTabs(
  sessionIds: readonly string[],
  activeSessionId: string | null,
  availableSessionIds: ReadonlySet<string>,
): { sessionIds: string[]; activeSessionId: string | null } {
  const nextSessionIds = sessionIds.filter((id) => availableSessionIds.has(id));
  if (nextSessionIds.length === sessionIds.length) {
    return {
      sessionIds: nextSessionIds,
      activeSessionId:
        activeSessionId && availableSessionIds.has(activeSessionId)
          ? activeSessionId
          : (nextSessionIds.at(-1) ?? null),
    };
  }

  return {
    sessionIds: nextSessionIds,
    activeSessionId:
      activeSessionId && availableSessionIds.has(activeSessionId)
        ? activeSessionId
        : (nextSessionIds.at(-1) ?? null),
  };
}
