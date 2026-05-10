const composerDrafts = new Map<string, string>();

export function clearAllComposerDrafts(): void {
  composerDrafts.clear();
}

export function getComposerDraft(key: string): string {
  return composerDrafts.get(key) ?? '';
}

export function setComposerDraft(key: string, value: string): void {
  if (!value) {
    composerDrafts.delete(key);
    return;
  }
  composerDrafts.set(key, value);
}

export function clearComposerDraft(key: string): void {
  composerDrafts.delete(key);
}

export function buildComposerDraftKey(input: {
  sessionId?: string | null;
  connectionId?: string | null;
  mode: 'prompt' | 'queue';
}): string {
  return `${input.mode}:${input.sessionId ?? input.connectionId ?? 'global'}`;
}
