import { describe, expect, it } from 'vitest';
import {
  buildBackgroundSubagentModel,
  buildBackgroundSubagentCompletionMessage,
  buildBackgroundSubagentCompletionInjection,
  buildBackgroundSubagentPromptBody,
  buildBackgroundSubagentPromptModel,
  buildConnectedBackgroundSubagentModels,
  buildModelRecommendations,
  extractAssistantTextFromMessages,
  resolveBackgroundSubagentBaseDirectory,
  resolvePresetModelSelection,
  serializeBackgroundSubagentRecord,
  summarizeBackgroundSubagentStatus,
  TOOL_DESCRIPTION,
  validateBackgroundSubagentModelSelection,
} from './manage-background-subagents';

describe('manage-background-subagents helpers', () => {
  it('builds a prompt_async body with text and optional agent', () => {
    expect(
      buildBackgroundSubagentPromptBody({
        prompt: 'Inspect auth flow',
        agent: ' docs-maintainer ',
      }),
    ).toEqual({
      parts: [{ type: 'text', text: 'Inspect auth flow' }],
      agent: 'docs-maintainer',
    });
  });

  it('adds explicit provider model selection to prompt body when requested', () => {
    expect(
      buildBackgroundSubagentPromptBody({
        prompt: 'Inspect auth flow',
        model: { providerID: 'github-copilot', modelID: 'gpt-5.5' },
        variant: 'xhigh',
      }),
    ).toEqual({
      parts: [{ type: 'text', text: 'Inspect auth flow' }],
      model: { providerID: 'github-copilot', modelID: 'gpt-5.5' },
      variant: 'max',
    });
  });

  it('builds session create and prompt model refs from provider/model ids', () => {
    expect(
      buildBackgroundSubagentModel({
        providerId: ' github-copilot ',
        modelId: ' gpt-5.5 ',
      }),
    ).toEqual({ providerID: 'github-copilot', id: 'gpt-5.5' });

    expect(
      buildBackgroundSubagentPromptModel({
        providerId: ' github-copilot ',
        modelId: ' gpt-5.5 ',
      }),
    ).toEqual({ providerID: 'github-copilot', modelID: 'gpt-5.5' });
  });

  it('omits model selection unless both provider and model are present', () => {
    expect(
      buildBackgroundSubagentModel({ providerId: 'github-copilot' }),
    ).toBeUndefined();
    expect(
      buildBackgroundSubagentPromptModel({ modelId: 'gpt-5.5' }),
    ).toBeUndefined();
  });

  it('prefers the parent OpenCode session directory over the registered base directory', () => {
    expect(
      resolveBackgroundSubagentBaseDirectory({
        parentSessionDirectory: '/repo/current-session',
        registeredBaseDirectory: '/repo/registered-root',
      }),
    ).toBe('/repo/current-session');
  });

  it('falls back to the registered base directory when parent session directory is unavailable', () => {
    expect(
      resolveBackgroundSubagentBaseDirectory({
        parentSessionDirectory: null,
        registeredBaseDirectory: '/repo/registered-root',
      }),
    ).toBe('/repo/registered-root');
  });

  it('omits blank agent from the prompt body', () => {
    expect(
      buildBackgroundSubagentPromptBody({
        prompt: 'Inspect auth flow',
        agent: '   ',
      }),
    ).toEqual({
      parts: [{ type: 'text', text: 'Inspect auth flow' }],
    });
  });

  it('returns only connected provider models for background subagents', () => {
    expect(
      buildConnectedBackgroundSubagentModels({
        providers: [
          {
            id: 'github-copilot',
            name: 'GitHub Copilot',
            models: [{ id: 'gpt-5.5', name: 'GPT 5.5' }],
          },
          {
            id: 'anthropic',
            name: 'Anthropic',
            models: [{ id: 'claude-opus-4.6', name: 'Claude Opus' }],
          },
        ],
        connectedProviderIds: ['github-copilot'],
        defaults: { provider: 'github-copilot' },
      }),
    ).toEqual({
      providers: [
        {
          id: 'github-copilot',
          name: 'GitHub Copilot',
          models: [{ id: 'gpt-5.5', name: 'GPT 5.5' }],
        },
      ],
      connectedProviderIds: ['github-copilot'],
      defaults: { provider: 'github-copilot' },
      recommendations: [
        {
          providerId: 'github-copilot',
          modelId: 'gpt-5.5',
          recommendedFor: ['deep-reasoning', 'precise-review'],
          suggestedVariant: undefined,
        },
      ],
    });
  });

  it('adds recommendation metadata to connected models', () => {
    expect(
      buildModelRecommendations({
        id: 'github-copilot',
        name: 'GitHub Copilot',
        models: [
          {
            id: 'gpt-5.5',
            name: 'GPT 5.5',
            reasoning: true,
            variants: ['high'],
          },
          { id: 'gpt-5-mini', name: 'GPT 5 Mini' },
        ],
      }),
    ).toEqual([
      {
        providerId: 'github-copilot',
        modelId: 'gpt-5.5',
        recommendedFor: ['deep-reasoning', 'precise-review'],
        suggestedVariant: 'high',
      },
      {
        providerId: 'github-copilot',
        modelId: 'gpt-5-mini',
        recommendedFor: ['predefined-labor', 'fast-check'],
        suggestedVariant: undefined,
      },
    ]);
  });

  it('resolves preset model selections from recommendations', () => {
    const models = buildConnectedBackgroundSubagentModels({
      providers: [
        {
          id: 'github-copilot',
          name: 'GitHub Copilot',
          models: [
            { id: 'gpt-5-mini', name: 'GPT 5 Mini' },
            { id: 'gpt-5.5', name: 'GPT 5.5', variants: ['high'] },
          ],
        },
      ],
      connectedProviderIds: ['github-copilot'],
      defaults: {},
    });

    expect(resolvePresetModelSelection('deep', models)).toEqual({
      providerId: 'github-copilot',
      modelId: 'gpt-5.5',
      variant: 'high',
    });
    expect(resolvePresetModelSelection('labor', models)).toEqual({
      providerId: 'github-copilot',
      modelId: 'gpt-5-mini',
      variant: undefined,
    });
  });

  it('rejects model selections that are not connected provider/model pairs', () => {
    const models = buildConnectedBackgroundSubagentModels({
      providers: [
        {
          id: 'github-copilot',
          name: 'GitHub Copilot',
          models: [{ id: 'gpt-5.5', name: 'GPT 5.5' }],
        },
      ],
      connectedProviderIds: ['github-copilot'],
      defaults: {},
    });

    expect(
      validateBackgroundSubagentModelSelection(
        { providerId: 'github-copilot', modelId: 'gpt-5.5' },
        models,
      ),
    ).toEqual({ ok: true });
    expect(
      validateBackgroundSubagentModelSelection(
        { providerId: 'github-copilot', modelId: 'claude-opus-4.6' },
        models,
      ),
    ).toEqual({
      ok: false,
      error:
        'Invalid model selection. Use action="models" and choose a connected provider/model from the returned list.',
    });
  });

  it('extracts assistant text from OpenCode message parts', () => {
    expect(
      extractAssistantTextFromMessages([
        {
          role: 'user',
          parts: [{ type: 'text', text: 'question' }],
        },
        {
          role: 'assistant',
          parts: [
            { type: 'reasoning', text: 'hidden' },
            { type: 'text', text: 'answer' },
          ],
        },
      ]),
    ).toBe('answer');
  });

  it('extracts assistant text from OpenCode REST message rows', () => {
    expect(
      extractAssistantTextFromMessages([
        {
          info: {
            role: 'user',
          },
          parts: [{ type: 'text', text: 'question' }],
        },
        {
          info: {
            role: 'assistant',
          },
          parts: [
            { type: 'reasoning', text: 'hidden' },
            { type: 'text', text: 'answer' },
          ],
        },
      ]),
    ).toBe('answer');
  });

  it('builds a parent completion notification message', () => {
    expect(
      buildBackgroundSubagentCompletionMessage({
        record: {
          id: 'bg_123',
          sessionId: 'ses_child',
          title: 'Inspect API',
          status: 'completed',
          error: null,
        },
        output: 'All done.',
      }),
    ).toContain('Background subagent "Inspect API" has finished.');
  });

  it('builds parent completion injection with noReply disabled', () => {
    const injection = buildBackgroundSubagentCompletionInjection({
      parentSessionId: 'ses_parent',
      record: {
        id: 'bg_123',
        sessionId: 'ses_child',
        title: 'Inspect API',
        status: 'completed',
        error: null,
      },
      output: 'All done.',
    });

    expect(injection.sessionId).toBe('ses_parent');
    expect(injection.noReply).toBe(false);
    expect(injection.message).toContain(
      'Background subagent "Inspect API" has finished.',
    );
  });

  it('summarizes status using live OpenCode status first', () => {
    expect(
      summarizeBackgroundSubagentStatus({
        localStatus: 'running',
        liveStatus: 'idle',
      }),
    ).toBe('completed');
  });

  it('serializes elapsed and stale metadata for background subagents', () => {
    const serialized = serializeBackgroundSubagentRecord(
      {
        id: 'bg_123',
        sessionId: 'ses_child',
        parentSessionId: 'ses_parent',
        prompt: 'Work',
        title: 'Work',
        agent: null,
        model: null,
        baseDirectory: '/repo',
        status: 'running',
        error: null,
        completionNotifiedAt: null,
        startedAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
      new Date(11 * 60_000).toISOString(),
    );

    expect(serialized.elapsedMs).toBe(11 * 60_000);
    expect(serialized.isPossiblyStalled).toBe(true);
  });

  it('keeps agent-facing tool description synchronized with required guidance', () => {
    expect(TOOL_DESCRIPTION).toContain('action="models"');
    expect(TOOL_DESCRIPTION).toContain('preset');
    expect(TOOL_DESCRIPTION).toContain('noReply=false');
    expect(TOOL_DESCRIPTION).toContain('gpt-5-mini');
  });
});
