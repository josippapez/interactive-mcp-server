import { describe, expect, it } from 'vitest';

import type { Model } from '../../hooks/useProviders';
import { resolveCurrentModel } from './model-resolution';

const MODELS: Model[] = [
  {
    id: 'gpt-5.3-codex',
    name: 'GPT-5.3 Codex (Copilot)',
    providerId: 'github-copilot',
    providerName: 'GitHub Copilot',
    reasoning: true,
    variants: ['low', 'medium', 'high', 'xhigh'],
    defaultVariant: 'high',
  },
  {
    id: 'gpt-5.3-codex',
    name: 'GPT-5.3 Codex (Other)',
    providerId: 'other-provider',
    providerName: 'Other Provider',
    reasoning: true,
    variants: ['low', 'medium', 'high'],
    defaultVariant: 'medium',
  },
];

describe('resolveCurrentModel', () => {
  it('prefers exact provider+model match when providerId is provided', () => {
    const result = resolveCurrentModel(
      MODELS,
      'gpt-5.3-codex',
      'github-copilot',
    );

    expect(result?.providerId).toBe('github-copilot');
    expect(result?.variants).toEqual(['low', 'medium', 'high', 'xhigh']);
  });

  it('falls back to modelId-only lookup when provider is missing', () => {
    const result = resolveCurrentModel(MODELS, 'gpt-5.3-codex');

    expect(result).not.toBeNull();
    expect(result?.id).toBe('gpt-5.3-codex');
  });

  it('falls back to modelId-only lookup when provider-specific match is missing', () => {
    const result = resolveCurrentModel(
      MODELS,
      'gpt-5.3-codex',
      'non-existent-provider',
    );

    expect(result).not.toBeNull();
    expect(result?.id).toBe('gpt-5.3-codex');
  });

  it('returns null when modelId is not provided', () => {
    expect(resolveCurrentModel(MODELS, null, 'github-copilot')).toBeNull();
  });
});
