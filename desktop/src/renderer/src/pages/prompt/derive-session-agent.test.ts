import { describe, expect, it } from 'vitest';
import {
  deriveSessionAgentFromConversation,
  type DeriveSessionAgentMessage,
} from './derive-session-agent';

describe('deriveSessionAgentFromConversation', () => {
  it('returns null for an empty conversation', () => {
    expect(deriveSessionAgentFromConversation([])).toBeNull();
  });

  it('returns null when no assistant message carries an agent', () => {
    const msgs: DeriveSessionAgentMessage[] = [
      { role: 'user', agent: 'self-improvement' },
      { role: 'assistant' },
      { role: 'assistant', agent: '' },
      { role: 'assistant', agent: '   ' },
    ];
    expect(deriveSessionAgentFromConversation(msgs)).toBeNull();
  });

  it('returns the agent of the most recent assistant message', () => {
    const msgs: DeriveSessionAgentMessage[] = [
      { role: 'assistant', agent: 'build' },
      { role: 'user' },
      { role: 'assistant', agent: 'self-improvement' },
    ];
    expect(deriveSessionAgentFromConversation(msgs)).toBe('self-improvement');
  });

  it('trims whitespace from the returned agent', () => {
    const msgs: DeriveSessionAgentMessage[] = [
      { role: 'assistant', agent: '  plan  ' },
    ];
    expect(deriveSessionAgentFromConversation(msgs)).toBe('plan');
  });

  it('skips user messages even when they carry an agent', () => {
    const msgs: DeriveSessionAgentMessage[] = [
      { role: 'user', agent: 'self-improvement' },
      { role: 'assistant', agent: 'build' },
    ];
    expect(deriveSessionAgentFromConversation(msgs)).toBe('build');
  });

  it('skips assistant messages with empty/whitespace agents and uses an older one', () => {
    const msgs: DeriveSessionAgentMessage[] = [
      { role: 'assistant', agent: 'plan' },
      { role: 'user' },
      { role: 'assistant', agent: '' },
      { role: 'assistant', agent: '   ' },
    ];
    expect(deriveSessionAgentFromConversation(msgs)).toBe('plan');
  });
});
