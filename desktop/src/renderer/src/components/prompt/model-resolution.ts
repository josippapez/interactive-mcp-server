import type { Model } from '../../hooks/useProviders';

/**
 * Resolve the current model from the providers list.
 *
 * Prefers an exact provider+model match when providerId is available, and
 * falls back to modelId-only lookup for backward compatibility.
 */
export function resolveCurrentModel(
  models: Model[],
  modelId?: string | null,
  providerId?: string | null,
): Model | null {
  if (!modelId) return null;

  if (providerId) {
    const exactMatch = models.find(
      (model) => model.id === modelId && model.providerId === providerId,
    );
    if (exactMatch) return exactMatch;
  }

  return models.find((model) => model.id === modelId) ?? null;
}
