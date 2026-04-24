import { describe, expect, it } from 'vitest';
import type { PromptData } from '../../types';

function getPromptBannerText(prompt: PromptData): string {
  return prompt.message.trim();
}

describe('prompt banner content', () => {
  it('keeps the actual prompt message visible', () => {
    const prompt: PromptData = {
      id: 'prompt-1',
      message: 'I am proceeding on two tracks. Is that the right scope?',
      projectName: 'interactive-mcp-server',
      connectionName: 'Claude Code',
      timeoutSeconds: 1200,
      expiresAt: 0,
      providerSessionId: 'ses_123',
    };

    expect(getPromptBannerText(prompt)).toBe(
      'I am proceeding on two tracks. Is that the right scope?',
    );
  });
});
