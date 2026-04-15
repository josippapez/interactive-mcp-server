import { useCallback } from 'react';
import type { ModelOverride } from '../../hooks/useProviderInjection';
import type { Model } from '../../hooks/useProviders';
import {
  useSelectSessionModel,
  useSessionModelSelection,
} from '../../store/session-models';

type CreateModelSelection = {
  providerId: string;
  modelId: string;
  variant?: string;
};

export function usePromptModelState(openCodeSessionId: string | null) {
  const { currentModelOverride } = useSessionModelSelection(openCodeSessionId);
  const selectSessionModel = useSelectSessionModel();

  const handleModelSelect = useCallback(
    (model: Model, variant?: string) => {
      if (!openCodeSessionId) {
        return;
      }

      selectSessionModel(openCodeSessionId, {
        providerId: model.providerId,
        modelId: model.id,
        variant,
      });
    },
    [openCodeSessionId, selectSessionModel],
  );

  const handleSaveCreateModelSelection = useCallback(
    (sessionId: string, modelSelection?: CreateModelSelection) => {
      if (!modelSelection) {
        return;
      }

      selectSessionModel(sessionId, modelSelection);
    },
    [selectSessionModel],
  );

  return {
    currentModelOverride,
    handleModelSelect,
    handleSaveCreateModelSelection,
  };
}
