import { describe, expect, it, beforeEach } from 'vitest';
import {
  buildComposerDraftKey,
  clearAllComposerDrafts,
  clearComposerDraft,
  getComposerDraft,
  setComposerDraft,
} from './composer-drafts';

describe('composer-drafts', () => {
  beforeEach(() => {
    clearAllComposerDrafts();
  });

  it('persists drafts by session and mode', () => {
    const queueKey = buildComposerDraftKey({
      mode: 'queue',
      sessionId: 'ses_1',
      connectionId: 'conn_1',
    });
    const promptKey = buildComposerDraftKey({
      mode: 'prompt',
      sessionId: 'ses_1',
      connectionId: 'conn_1',
    });

    setComposerDraft(queueKey, 'queued text');
    setComposerDraft(promptKey, 'prompt text');

    expect(getComposerDraft(queueKey)).toBe('queued text');
    expect(getComposerDraft(promptKey)).toBe('prompt text');
  });

  it('clears drafts after submit', () => {
    const key = buildComposerDraftKey({ mode: 'queue', sessionId: 'ses_1' });

    setComposerDraft(key, 'hello');
    clearComposerDraft(key);

    expect(getComposerDraft(key)).toBe('');
  });
});
