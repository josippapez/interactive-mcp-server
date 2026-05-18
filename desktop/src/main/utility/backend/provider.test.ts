import { describe, expect, it } from 'vitest';

import { mergeV2ProviderModelInfo, type ProvidersInfo } from './provider';

describe('mergeV2ProviderModelInfo', () => {
  const legacy: ProvidersInfo = {
    providers: [
      {
        id: 'github-copilot',
        name: 'GitHub Copilot',
        models: [
          {
            id: 'gpt-5.5',
            name: 'GPT 5.5 old',
            contextWindow: 100,
            inputLimit: 80,
            outputLimit: 20,
            reasoning: true,
            variants: ['medium', 'high'],
            defaultVariant: 'medium',
          },
        ],
      },
      {
        id: 'disconnected',
        name: 'Disconnected',
        models: [{ id: 'old', name: 'Old' }],
      },
    ],
    connectedProviderIds: ['github-copilot'],
    defaults: { github: 'gpt-5.5' },
  };

  it('preserves legacy model metadata and only adds v2-only models', () => {
    const merged = mergeV2ProviderModelInfo(
      legacy,
      [{ id: 'github-copilot', name: 'GitHub Copilot v2', enabled: {} }],
      [
        {
          id: 'gpt-5.5',
          name: 'GPT 5.5',
          providerID: 'github-copilot',
          enabled: true,
          limit: { context: 200, input: 150, output: 50 },
        },
        {
          id: 'gpt-6',
          name: 'GPT 6',
          providerID: 'github-copilot',
          enabled: true,
          limit: { context: 300, input: 200, output: 100 },
          variants: [{ id: 'high' }],
        },
      ],
    );

    expect(merged.connectedProviderIds).toEqual(['github-copilot']);
    expect(merged.defaults).toEqual({ github: 'gpt-5.5' });
    expect(merged.providers[0]).toMatchObject({
      id: 'github-copilot',
      name: 'GitHub Copilot v2',
      models: [
        {
          id: 'gpt-5.5',
          name: 'GPT 5.5 old',
          contextWindow: 100,
          inputLimit: 80,
          outputLimit: 20,
          reasoning: true,
          variants: ['medium', 'high'],
          defaultVariant: 'medium',
        },
        {
          id: 'gpt-6',
          name: 'GPT 6',
          contextWindow: 300,
          inputLimit: 200,
          outputLimit: 100,
          reasoning: true,
          variants: ['high'],
          defaultVariant: 'high',
        },
      ],
    });
    expect(merged.providers[1]).toBe(legacy.providers[1]);
  });

  it('enriches an existing legacy model with v2 effort variants when v2 provides them', () => {
    const merged = mergeV2ProviderModelInfo(
      {
        ...legacy,
        providers: [
          {
            id: 'github-copilot',
            name: 'GitHub Copilot',
            models: [
              {
                id: 'gpt-5.1',
                name: 'GPT-5.1',
                reasoning: false,
              },
            ],
          },
        ],
      },
      [{ id: 'github-copilot', name: 'GitHub Copilot v2', enabled: {} }],
      [
        {
          id: 'gpt-5.1',
          name: 'GPT-5.1',
          providerID: 'github-copilot',
          enabled: true,
          variants: [{ id: 'low' }, { id: 'medium' }, { id: 'high' }],
        },
      ],
    );

    expect(merged.providers[0].models[0]).toMatchObject({
      id: 'gpt-5.1',
      reasoning: true,
      variants: ['low', 'medium', 'high'],
      defaultVariant: 'medium',
    });
  });

  it('falls back to legacy metadata when v2 data is unavailable', () => {
    expect(mergeV2ProviderModelInfo(legacy, null, null)).toBe(legacy);
  });
});
