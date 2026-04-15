import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useMemo } from 'react';
import {
  loadModelOverrides,
  saveModelOverrides,
} from '../hooks/model-override-persistence';
import type { ModelOverride } from '../hooks/useProviderInjection';
import { findModelById, modelsAtom } from './providers';

type SessionBaseModel = {
  modelId: string | null;
  providerId: string | null;
};

type SessionBaseModelMap = Record<string, SessionBaseModel>;
type SessionModelOverrideMap = Map<string, ModelOverride>;

export const sessionBaseModelsAtom = atom<SessionBaseModelMap>({});
export const sessionModelOverridesAtom =
  atom<SessionModelOverrideMap>(loadModelOverrides());

export function useSetSessionBaseModel(): (
  sessionId: string,
  modelId: string | null,
  providerId: string | null,
) => void {
  const setBaseModels = useSetAtom(sessionBaseModelsAtom);

  return useCallback(
    (sessionId: string, modelId: string | null, providerId: string | null) => {
      setBaseModels((prev) => {
        const current = prev[sessionId];
        if (
          current?.modelId === modelId &&
          current?.providerId === providerId
        ) {
          return prev;
        }

        return {
          ...prev,
          [sessionId]: { modelId, providerId },
        };
      });
    },
    [setBaseModels],
  );
}

export function useSelectSessionModel(): (
  sessionId: string,
  override: ModelOverride,
) => void {
  const setOverrides = useSetAtom(sessionModelOverridesAtom);

  return useCallback(
    (sessionId: string, override: ModelOverride) => {
      setOverrides((prev) => {
        const next = new Map(prev);
        next.set(sessionId, override);
        saveModelOverrides(next);
        return next;
      });
    },
    [setOverrides],
  );
}

export function useSessionModelSelection(sessionId: string | null): {
  currentModelOverride: ModelOverride | undefined;
  modelId: string | null;
  providerId: string | null;
  variant: string | null;
  contextWindow?: number;
  inputLimit?: number;
  outputLimit?: number;
} {
  const baseModels = useAtomValue(sessionBaseModelsAtom);
  const overrides = useAtomValue(sessionModelOverridesAtom);
  const models = useAtomValue(modelsAtom);

  return useMemo(() => {
    if (!sessionId) {
      return {
        currentModelOverride: undefined,
        modelId: null,
        providerId: null,
        variant: null,
      };
    }

    const base = baseModels[sessionId];
    const currentModelOverride = overrides.get(sessionId);
    const modelId = currentModelOverride?.modelId ?? base?.modelId ?? null;
    const providerId =
      currentModelOverride?.providerId ?? base?.providerId ?? null;
    const variant = currentModelOverride?.variant ?? null;
    const model = modelId ? findModelById(models, modelId, providerId) : null;

    return {
      currentModelOverride,
      modelId,
      providerId,
      variant,
      contextWindow: model?.contextWindow,
      inputLimit: model?.inputLimit,
      outputLimit: model?.outputLimit,
    };
  }, [baseModels, models, overrides, sessionId]);
}
