import { describe, expect, it } from 'vitest';
import {
  getDisplayToolName,
  shouldShowToolSubtitle,
} from './tool-name-display';

describe('tool name display helpers', () => {
  it('strips MCP namespace prefixes for compact raw tool badges', () => {
    expect(getDisplayToolName('mcp__opencode__skill')).toBe('skill');
    expect(getDisplayToolName('interactive-desktop::send_message')).toBe(
      'send_message',
    );
    expect(getDisplayToolName('bash')).toBe('bash');
  });

  it('hides subtitles already included in the title', () => {
    expect(
      shouldShowToolSubtitle(
        'Loaded skill: react-best-practices',
        'react-best-practices',
      ),
    ).toBe(false);
    expect(shouldShowToolSubtitle('Loaded skill', 'react-best-practices')).toBe(
      true,
    );
  });
});
