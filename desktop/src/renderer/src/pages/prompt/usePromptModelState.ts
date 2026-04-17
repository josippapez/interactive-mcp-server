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

export function usePromptModelState(providerSessionId: string | null) {
  const { currentModelOverride } = useSessionModelSelection(providerSessionId);
  const selectSessionModel = useSelectSessionModel();

  const handleModelSelect = useCallback(
    (model: Model, variant?: string) => {
      if (!providerSessionId) {
        return;
      }

      selectSessionModel(providerSessionId, {
        providerId: model.providerId,
        modelId: model.id,
        variant,
      });
    },
    [providerSessionId, selectSessionModel],
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
