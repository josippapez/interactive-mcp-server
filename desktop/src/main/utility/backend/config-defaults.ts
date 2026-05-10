import { getClient } from './sdk-client';

export type OpenCodeConfigDefaults = {
  model: string | null;
  providerId: string | null;
  modelId: string | null;
  variant: string | null;
  defaultAgentName: string | null;
};

export function parseConfigModel(
  model: string | undefined,
): Pick<OpenCodeConfigDefaults, 'model' | 'providerId' | 'modelId'> {
  const trimmed = model?.trim();
  if (!trimmed) return { model: null, providerId: null, modelId: null };

  const slashIndex = trimmed.indexOf('/');
  if (slashIndex <= 0 || slashIndex === trimmed.length - 1) {
    return { model: trimmed, providerId: null, modelId: trimmed };
  }

  return {
    model: trimmed,
    providerId: trimmed.slice(0, slashIndex),
    modelId: trimmed.slice(slashIndex + 1),
  };
}

export async function fetchOpenCodeConfigDefaults(
  openCodePort: number,
  baseDirectory?: string,
): Promise<OpenCodeConfigDefaults> {
  const client = getClient(openCodePort, baseDirectory);
  const response = await client.config.get(
    baseDirectory ? { directory: baseDirectory } : undefined,
    { signal: AbortSignal.timeout(5000) },
  );

  if (response.error) {
    throw new Error(`OpenCode config error: ${JSON.stringify(response.error)}`);
  }

  const parsedModel = parseConfigModel(response.data?.model);
  const defaultAgentName = response.data?.default_agent?.trim() || null;
  const effectiveDefaultAgentName = defaultAgentName ?? 'build';
  const agentConfig = response.data?.agent?.[effectiveDefaultAgentName];
  const parsedAgentModel = parseConfigModel(agentConfig?.model);
  const variant = agentConfig?.variant?.trim() || null;

  return {
    ...(parsedAgentModel.model ? parsedAgentModel : parsedModel),
    variant,
    defaultAgentName,
  };
}
