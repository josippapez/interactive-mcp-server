import { describe, expect, it } from 'vitest';
import { resolvePendingAgentAssignment } from './pending-agent-assignment';

describe('resolvePendingAgentAssignment', () => {
  it('returns null when no pending agent is recorded', () => {
    expect(
      resolvePendingAgentAssignment({
        matchedNodeId: 'node-1',
        matchedSessionId: 'ses_abc',
        pendingNewSessionAgent: null,
      }),
    ).toBeNull();
  });

  it('returns null when the pending agent is for a different session', () => {
    expect(
      resolvePendingAgentAssignment({
        matchedNodeId: 'node-1',
        matchedSessionId: 'ses_abc',
        pendingNewSessionAgent: { sessionId: 'ses_xyz', agent: 'plan' },
      }),
    ).toBeNull();
  });

  it('returns null when the pending agent is empty/whitespace', () => {
    expect(
      resolvePendingAgentAssignment({
        matchedNodeId: 'node-1',
        matchedSessionId: 'ses_abc',
        pendingNewSessionAgent: { sessionId: 'ses_abc', agent: '   ' },
      }),
    ).toBeNull();
  });

  it('returns the assignment when the pending agent matches the matched session', () => {
    expect(
      resolvePendingAgentAssignment({
        matchedNodeId: 'node-1',
        matchedSessionId: 'ses_abc',
        pendingNewSessionAgent: { sessionId: 'ses_abc', agent: 'plan' },
      }),
    ).toEqual({ connectionId: 'node-1', agent: 'plan' });
  });

  it('trims whitespace from the agent name before returning', () => {
    expect(
      resolvePendingAgentAssignment({
        matchedNodeId: 'node-1',
        matchedSessionId: 'ses_abc',
        pendingNewSessionAgent: {
          sessionId: 'ses_abc',
          agent: '  docs-maintainer  ',
        },
      }),
    ).toEqual({ connectionId: 'node-1', agent: 'docs-maintainer' });
  });
});
