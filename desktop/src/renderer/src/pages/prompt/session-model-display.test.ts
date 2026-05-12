import { describe, expect, it } from 'vitest';
import { resolveDisplayedSessionModel } from './session-model-display';

describe('resolveDisplayedSessionModel', () => {
  it('prefers the running session model over the selected composer override', () => {
    expect(
      resolveDisplayedSessionModel({
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

  it('falls back to the selected composer model before the session reports one', () => {
    expect(
      resolveDisplayedSessionModel({
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
