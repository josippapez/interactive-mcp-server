import { describe, expect, it } from 'vitest';
import type { Event as SdkEvent } from '@opencode-ai/sdk/v2/client';
import { bridgeEvent } from './event-bridge';

describe('bridgeEvent', () => {
  it('maps session.next.step.started model variant into conversation events', () => {
    const events = bridgeEvent({
      id: 'msg_step',
      type: 'session.next.step.started',
      properties: {
        timestamp: 123,
        sessionID: 'ses_1',
        agent: 'build',
        model: {
          id: 'claude-opus-4.6',
          providerID: 'github-copilot',
          variant: 'max',
        },
      },
    } as SdkEvent);

    expect(events).toEqual([
      {
        type: 'session.next.step.started',
        sessionId: 'ses_1',
        messageId: 'msg_step',
        agent: 'build',
        modelId: 'claude-opus-4.6',
        providerId: 'github-copilot',
        variant: 'xhigh',
        timestamp: 123,
      },
    ]);
  });

  it('forwards retry details from the session.status retry variant', () => {
    const events = bridgeEvent({
      type: 'session.status',
      properties: {
        sessionID: 'ses_1',
        status: {
          type: 'retry',
          attempt: 2,
          message: 'The usage limit has been reached',
          next: 1_780_000_000_000,
        },
      },
    } as SdkEvent);

    expect(events).toEqual([
      {
        type: 'session.status',
        sessionId: 'ses_1',
        status: 'streaming',
        retry: {
          attempt: 2,
          message: 'The usage limit has been reached',
          next: 1_780_000_000_000,
        },
      },
    ]);
  });

  it('maps busy session.status without a retry payload', () => {
    const events = bridgeEvent({
      type: 'session.status',
      properties: {
        sessionID: 'ses_1',
        status: { type: 'busy' },
      },
    } as SdkEvent);

    expect(events).toEqual([
      { type: 'session.status', sessionId: 'ses_1', status: 'streaming' },
    ]);
  });

  it('maps permission asked directory from the event envelope', () => {
    const events = bridgeEvent(
      {
        id: 'evt_permission',
        type: 'permission.asked',
        properties: {
          sessionID: 'ses_1',
          id: 'per_1',
          permission: 'external_directory',
          patterns: ['/tmp/file.png'],
          always: ['external_directory'],
        },
      } as SdkEvent,
      { directory: '/repo' },
    );

    expect(events).toEqual([
      {
        type: 'permission.asked',
        sessionId: 'ses_1',
        requestId: 'per_1',
        permission: 'external_directory',
        patterns: ['/tmp/file.png'],
        always: ['external_directory'],
        tool: undefined,
        metadata: undefined,
        directory: '/repo',
      },
    ]);
  });
});
