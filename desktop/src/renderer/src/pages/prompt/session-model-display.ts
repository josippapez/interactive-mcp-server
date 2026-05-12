type ModelSelection = {
  modelId: string | null;
  providerId: string | null;
  variant: string | null;
};

export function resolveDisplayedSessionModel(input: {
  runningModel: ModelSelection;
  selectedModel: ModelSelection;
  hasOverride: boolean;
}): ModelSelection {
  if (input.hasOverride) {
    return input.selectedModel;
  }

  if (input.runningModel.modelId) {
    return input.runningModel;
  }

  return input.selectedModel;
}
