import { describe, expect, it } from 'vitest';
import {
  formatDurationMs,
  formatModeName,
  getAssistantHeaderMetadata,
  getAttachmentKey,
  getEffortBadge,
  getExecutionStatusLabel,
} from './message-item-helpers';

describe('getAttachmentKey', () => {
  it('disambiguates duplicate attachments in the same message', () => {
    const attachment = {
      data: 'abc',
      mimeType: 'image/png',
      name: 'image.png',
      size: 3,
    };

    expect(getAttachmentKey('db-56', attachment, 0)).toBe(
      'db-56-att-0-image.png-image/png',
    );
    expect(getAttachmentKey('db-56', attachment, 1)).toBe(
      'db-56-att-1-image.png-image/png',
    );
  });
});

describe('getEffortBadge', () => {
  it('maps known reasoning variants to visible badges', () => {
    expect(getEffortBadge('low')).toEqual({
      label: 'Low effort',
      variant: 'effort-low',
    });
    expect(getEffortBadge('XHIGH')).toEqual({
      label: 'Max effort',
      variant: 'effort-xhigh',
    });
  });

  it('maps none and minimal variants', () => {
    expect(getEffortBadge('none')).toEqual({
      label: 'No reasoning',
      variant: 'effort-none',
    });
    expect(getEffortBadge('minimal')).toEqual({
      label: 'Minimal effort',
      variant: 'effort-minimal',
    });
  });

  it('normalizes provider max variant to canonical xhigh badge', () => {
    expect(getEffortBadge('max')).toEqual({
      label: 'Max effort',
      variant: 'effort-xhigh',
    });
  });

  it('returns null for unknown or missing variants', () => {
    expect(getEffortBadge()).toBeNull();
    expect(getEffortBadge('turbo')).toBeNull();
  });
});

describe('getAssistantHeaderMetadata', () => {
  it('returns reliable assistant header badges from mapped message metadata', () => {
    expect(
      getAssistantHeaderMetadata({
        agent: 'code-reviewer',
        modelId: 'gpt-5.5',
        roleLabel: 'Code Reviewer',
        variant: 'high',
      }),
    ).toEqual({
      agentBadgeLabel: 'Code Reviewer',
      effortBadge: { label: 'High effort', variant: 'effort-high' },
      modelLabel: 'gpt-5.5',
    });
  });

  it('does not show a main-agent badge or unknown effort badge', () => {
    expect(
      getAssistantHeaderMetadata({
        agent: 'main',
        roleLabel: 'Main Agent',
        variant: 'turbo',
      }),
    ).toEqual({
      agentBadgeLabel: null,
      effortBadge: null,
      modelLabel: null,
    });
  });
});

describe('formatDurationMs', () => {
  it('formats short and long durations', () => {
    expect(formatDurationMs(250)).toBe('250ms');
    expect(formatDurationMs(1500)).toBe('1.5s');
    expect(formatDurationMs(65_000)).toBe('1m 5s');
  });
});

describe('formatModeName', () => {
  it('formats OpenCode mode labels', () => {
    expect(formatModeName('build')).toBe('Build');
    expect(formatModeName('plan_review')).toBe('Plan Review');
  });
});

describe('getExecutionStatusLabel', () => {
  it('shows completed duration when available', () => {
    expect(
      getExecutionStatusLabel({
        completedAt: 2_500,
        isStreaming: false,
        now: 5_000,
        source: 'conversation',
        timestamp: 1_000,
        userSide: false,
      }),
    ).toBe('1.5s');
  });

  it('shows live executing elapsed only while streaming assistant conversation messages', () => {
    expect(
      getExecutionStatusLabel({
        isStreaming: true,
        now: 3_500,
        source: 'conversation',
        timestamp: 1_000,
        userSide: false,
      }),
    ).toBe('executing 2.5s');
  });

  it('hides executing for stopped messages without completion time', () => {
    expect(
      getExecutionStatusLabel({
        isStreaming: false,
        now: 3_500,
        source: 'conversation',
        timestamp: 1_000,
        userSide: false,
      }),
    ).toBeNull();
  });
});
