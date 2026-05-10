import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChannelMessage, PromptData } from '../../types';

type Args = {
  prompt: PromptData | null;
  activeSession: { id: string; title: string } | null;
  channelMessages: ChannelMessage[];
  conversationMessagesLength: number;
  activeConnectionId: string | null;
};

export function usePromptRuntimeState({
  prompt,
  activeSession,
  channelMessages,
  conversationMessagesLength,
  activeConnectionId,
}: Args) {
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const expiresAtRef = useRef<Map<string, number>>(new Map());

  const idle =
    !prompt &&
    !activeSession &&
    channelMessages.length === 0 &&
    conversationMessagesLength === 0;

  const activePromptId = useMemo(() => {
    if (!prompt) {
      return null;
    }

    for (let i = channelMessages.length - 1; i >= 0; i--) {
      if (channelMessages[i].kind === 'question') {
        return channelMessages[i].id;
      }
    }

    return null;
  }, [prompt, channelMessages]);

  useEffect(() => {
    if (!prompt) {
      setSecondsLeft(null);
      return;
    }

    let expiry = expiresAtRef.current.get(prompt.id);
    if (!expiry) {
      if (prompt.expiresAt) {
        expiry = prompt.expiresAt;
      } else if (prompt.timeoutSeconds) {
        expiry = Date.now() + prompt.timeoutSeconds * 1000;
      }
      if (expiry) {
        expiresAtRef.current.set(prompt.id, expiry);
      }
    }

    if (!expiry) {
      setSecondsLeft(null);
      return;
    }

    const resolvedExpiry = expiry;
    const computeRemaining = () =>
      Math.max(0, Math.round((resolvedExpiry - Date.now()) / 1000));

    setSecondsLeft(computeRemaining());
    const interval = setInterval(() => {
      setSecondsLeft(computeRemaining());
    }, 1000);

    return () => clearInterval(interval);
  }, [prompt?.id, prompt]);

  useEffect(() => {
    setRemoveError(null);
  }, [activeConnectionId]);

  return {
    removeError,
    setRemoveError,
    commandPaletteOpen,
    setCommandPaletteOpen,
    idle,
    activePromptId,
    secondsLeft,
  };
}
