import type { PromptData, SessionNode } from '../../types';

export function getPromptComposerBaseDirectory(
  prompt: PromptData | null,
  activeConnectionId: string | null,
  connections: Map<string, SessionNode>,
): string | undefined {
  if (prompt?.baseDirectory) {
    return prompt.baseDirectory;
  }

  const node = activeConnectionId ? connections.get(activeConnectionId) : null;
  return node?.baseDirectory ?? node?.directory ?? undefined;
}

export function getPromptPlaceholder(
  prompt: PromptData | null,
  activeConnectionId: string | null,
  connections: Map<string, SessionNode>,
): string {
  if (getPromptComposerBaseDirectory(prompt, activeConnectionId, connections)) {
    return 'Type your answer… (# or @ for files, / for commands, ⌘+Enter to send)';
  }
  return 'Type your answer… (⌘+Enter to send)';
}

export function getQueueComposerBaseDirectory(
  activeConnectionId: string | null,
  connections: Map<string, SessionNode>,
): string | undefined {
  const node = activeConnectionId ? connections.get(activeConnectionId) : null;
  return node?.baseDirectory ?? node?.directory ?? undefined;
}
