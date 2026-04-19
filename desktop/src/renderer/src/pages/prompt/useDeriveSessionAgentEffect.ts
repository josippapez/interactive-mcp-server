import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect } from 'react';
import type { ConversationMessage } from '../../../../preload/index';
import {
  sessionAgentsAtom,
  setSessionAgentAtom,
} from '../../store/session-agents';
import { deriveSessionAgentFromConversation } from './derive-session-agent';

/**
 * Populates `sessionAgentsAtom` with the agent extracted from the most
 * recent assistant message whenever an existing session is opened.
 *
 * This complements the "new session" path (where the agent is passed to
 * `createOpenCodeSession` and then written into the atom by
 * `usePromptNavigationState`) so that a session the user has been running
 * under a custom agent (e.g. "self-improvement") shows the correct agent
 * in the bottom-bar selector after the app is restarted or the session is
 * switched to.
 *
 * Respect the user's explicit choice: if the atom already has an entry
 * for this `connectionId`, we do not overwrite it. The derived value is
 * only written the first time we see conversation messages for a
 * connection that has no recorded agent.
 */
export function useDeriveSessionAgentEffect(args: {
  connectionId: string | null;
  conversationMessages: ConversationMessage[];
}): void {
  const { connectionId, conversationMessages } = args;
  const sessionAgents = useAtomValue(sessionAgentsAtom);
  const setSessionAgent = useSetAtom(setSessionAgentAtom);

  useEffect(() => {
    if (!connectionId) return;
    if (conversationMessages.length === 0) return;
    if (sessionAgents.has(connectionId)) return;

    const derived = deriveSessionAgentFromConversation(conversationMessages);
    if (!derived) return;

    setSessionAgent({ connectionId, agent: derived });
  }, [connectionId, conversationMessages, sessionAgents, setSessionAgent]);
}
