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
});
