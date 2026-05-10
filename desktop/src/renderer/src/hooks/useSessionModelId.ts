import { useEffect } from 'react';
import { useConversationSelector } from '../store/conversation-store';
import { useSetSessionBaseModel } from '../store/session-models';

type SessionModelState = {
  modelId: string | null;
  providerId: string | null;
  variant: string | null;
};

/**
 * Hook exposing the model id + provider id for an OpenCode session.
 *
 * Derives the value from the live conversation store by scanning the
 * messages array for the most recent assistant message that has a
 * `modelId` attached. The store is kept current by the single
 * `conversation-batch` pipeline (`useConversation` on the same session
 * mounts the IPC listener and performs the REST seed).
 *
 * The previous orphan `onConversationMessageEvent` IPC subscription and
 * the per-session modelId REST fetch have been removed — the store is
 * already the single source of truth for conversation messages.
 */
export function useSessionModelId(
  providerSessionId: string | null,
  isOpenCodeSession: boolean,
): SessionModelState {
  const setSessionBaseModel = useSetSessionBaseModel();

  const state = useConversationSelector<SessionModelState>(
    (store) => {
      if (!isOpenCodeSession || !providerSessionId) {
        return { modelId: null, providerId: null, variant: null };
      }
      const sideChannelModel =
        store.sessionSideChannels[providerSessionId]?.model;
      if (sideChannelModel) {
        return {
          modelId: sideChannelModel.modelId,
          providerId: sideChannelModel.providerId,
          variant: sideChannelModel.variant ?? null,
        };
      }

      const messages = store.messages[providerSessionId];
      if (!messages) return { modelId: null, providerId: null, variant: null };

      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const msg = messages[i];
        if (msg.role === 'assistant' && msg.modelId) {
          return {
            modelId: msg.modelId,
            providerId: msg.providerId ?? null,
            variant: msg.variant ?? null,
          };
        }
      }
      return { modelId: null, providerId: null, variant: null };
    },
    (a, b) =>
      a.modelId === b.modelId &&
      a.providerId === b.providerId &&
      a.variant === b.variant,
  );

  // Side-effect: push the resolved model id into the per-session model
  // store so the composer's model picker reflects it. Runs in an effect
  // so it doesn't fire during render.
  useEffect(() => {
    if (!providerSessionId || !isOpenCodeSession || !state.modelId) return;
    setSessionBaseModel(
      providerSessionId,
      state.modelId,
      state.providerId,
      state.variant,
    );
  }, [
    providerSessionId,
    isOpenCodeSession,
    state.modelId,
    state.providerId,
    state.variant,
    setSessionBaseModel,
  ]);

  return state;
}
