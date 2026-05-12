import { describe, expect, it } from 'vitest';
import {
  buildBackgroundSubagentMessage,
  resolveMessageTarget,
} from './message-background-subagent';

describe('message-background-subagent helpers', () => {
  it('builds a no-reply coordination message envelope', () => {
    expect(
      buildBackgroundSubagentMessage({
        direction: 'to_subagent',
        fromSessionId: 'ses_parent',
        toSessionId: 'ses_child',
        reason: 'merge coordination',
        message: 'Pause before merging worktree.',
      }),
    ).toContain('<background-subagent-message>');
  });

  it('resolves parent-to-child target from background id record', () => {
    expect(
      resolveMessageTarget({
        direction: 'to_subagent',
        currentSessionId: 'ses_parent',
        backgroundSubagent: {
          sessionId: 'ses_child',
          parentSessionId: 'ses_parent',
        },
      }),
    ).toEqual({ fromSessionId: 'ses_parent', toSessionId: 'ses_child' });
  });

  it('resolves child-to-parent target from background id record', () => {
    expect(
      resolveMessageTarget({
        direction: 'to_parent',
        currentSessionId: 'ses_child',
        backgroundSubagent: {
          sessionId: 'ses_child',
          parentSessionId: 'ses_parent',
        },
      }),
    ).toEqual({ fromSessionId: 'ses_child', toSessionId: 'ses_parent' });
  });

  it('prefers explicit target session id', () => {
    expect(
      resolveMessageTarget({
        direction: 'to_subagent',
        currentSessionId: 'ses_current',
        targetSessionId: 'ses_target',
      }),
    ).toEqual({ fromSessionId: 'ses_current', toSessionId: 'ses_target' });
  });
});
