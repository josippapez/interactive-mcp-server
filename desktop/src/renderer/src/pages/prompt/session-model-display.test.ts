import { describe, expect, it } from 'vitest';
import { resolveDisplayedSessionModel } from './session-model-display';

describe('resolveDisplayedSessionModel', () => {
  it('prefers the running session model until the user selects an override', () => {
    expect(
      resolveDisplayedSessionModel({
        hasOverride: false,
        runningModel: {
          modelId: 'claude-opus',
          providerId: 'anthropic',
          variant: 'high',
        },
        selectedModel: {
          modelId: 'gpt-5.5',
          providerId: 'github-copilot',
          variant: 'xhigh',
        },
      }),
    ).toEqual({
      modelId: 'claude-opus',
      providerId: 'anthropic',
      variant: 'high',
    });
  });

  it('prefers an explicit composer override over the running session model', () => {
    expect(
      resolveDisplayedSessionModel({
        hasOverride: true,
        runningModel: {
          modelId: 'claude-opus',
          providerId: 'anthropic',
          variant: 'high',
        },
        selectedModel: {
          modelId: 'claude-opus',
          providerId: 'anthropic',
          variant: 'xhigh',
        },
      }),
    ).toEqual({
      modelId: 'claude-opus',
      providerId: 'anthropic',
      variant: 'xhigh',
    });
  });

  it('falls back to the selected composer model before the session reports one', () => {
    expect(
      resolveDisplayedSessionModel({
        hasOverride: false,
        runningModel: { modelId: null, providerId: null, variant: null },
        selectedModel: {
          modelId: 'gpt-5.5',
          providerId: 'github-copilot',
          variant: 'xhigh',
        },
      }),
    ).toEqual({
      modelId: 'gpt-5.5',
      providerId: 'github-copilot',
      variant: 'xhigh',
    });
  });
});
