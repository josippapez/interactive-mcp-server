import type { ToolCallInfo } from '../../../types/unified-message';

export const VIRTUAL_MESSAGE_OVERSCAN = 8;
export const VIRTUAL_MESSAGE_ESTIMATED_HEIGHT_PX = 180;

type TimelineMessage = {
  id: string;
  role?: string;
  text?: string;
  reasoning?: string;
  isActivePrompt?: boolean;
  toolCalls?: ToolCallInfo[];
};

export type TimelineRow = {
  type:
    | 'message'
    | 'assistant-reasoning'
    | 'assistant-text'
    | 'assistant-tools'
    | 'assistant-thinking';
  key: string;
  messageId: string;
  toolCalls?: ToolCallInfo[];
  firstForMessage: boolean;
};

interface VirtualMessageRowRegistration<TElement extends Element> {
  rowRefs: Map<string, TElement>;
  observedRows: Map<string, TElement>;
  resizeObserver: Pick<ResizeObserver, 'observe' | 'unobserve'> | null;
  measureElement: (node: TElement) => void;
}

export function shouldVirtualizeMessageList(messageCount: number): boolean {
  void messageCount;
  return messageCount >= 0;
}

function isContextToolName(toolName: string | undefined): boolean {
  if (!toolName) return false;
  const lower = toolName.toLowerCase();
  const baseName = lower.includes('__')
    ? lower.split('__').pop() || lower
    : lower;
  return [
    'read',
    'glob',
    'grep',
    'list',
    'search',
    'find',
    'cat',
    'head',
    'tail',
    'ls',
    'tree',
    'repo-docs',
    'find_docs',
    'list_docs',
    'read_doc',
    'find_libs',
    'resolve-library',
    'query-docs',
    'webfetch',
    'fetch',
  ].some((pattern) => baseName === pattern || baseName.includes(pattern));
}

function pushRow(
  rows: TimelineRow[],
  row: Omit<TimelineRow, 'firstForMessage'>,
): void {
  rows.push({
    ...row,
    firstForMessage: !rows.some(
      (existing) => existing.messageId === row.messageId,
    ),
  });
}

export function buildTimelineRows(
  messages: readonly TimelineMessage[],
): TimelineRow[] {
  const rows: TimelineRow[] = [];

  for (const message of messages) {
    if (message.role !== 'assistant') {
      pushRow(rows, {
        type: 'message',
        key: `message:${message.id}`,
        messageId: message.id,
      });
      continue;
    }

    const hasReasoning = Boolean(message.reasoning?.trim());
    const hasText = Boolean(message.text?.trim());
    const toolCalls = message.toolCalls ?? [];

    if (hasReasoning) {
      pushRow(rows, {
        type: 'assistant-reasoning',
        key: `assistant-reasoning:${message.id}`,
        messageId: message.id,
      });
    }
    if (hasText) {
      pushRow(rows, {
        type: 'assistant-text',
        key: `assistant-text:${message.id}`,
        messageId: message.id,
      });
    }

    if (toolCalls.length > 0) {
      let contextBuffer: ToolCallInfo[] = [];
      const flushContextBuffer = () => {
        if (contextBuffer.length === 0) return;
        if (contextBuffer.length === 1) {
          const tool = contextBuffer[0];
          pushRow(rows, {
            type: 'assistant-tools',
            key: `assistant-tools:${message.id}:tool:${tool.id}`,
            messageId: message.id,
            toolCalls: [tool],
          });
        } else {
          pushRow(rows, {
            type: 'assistant-tools',
            key: `assistant-tools:${message.id}:context:${contextBuffer[0].id}`,
            messageId: message.id,
            toolCalls: [...contextBuffer],
          });
        }
        contextBuffer = [];
      };

      for (const tool of toolCalls) {
        if (isContextToolName(tool.name)) {
          contextBuffer.push(tool);
          continue;
        }
        flushContextBuffer();
        pushRow(rows, {
          type: 'assistant-tools',
          key: `assistant-tools:${message.id}:tool:${tool.id}`,
          messageId: message.id,
          toolCalls: [tool],
        });
      }
      flushContextBuffer();
    }

    if (
      !hasReasoning &&
      !hasText &&
      toolCalls.length === 0 &&
      message.isActivePrompt
    ) {
      pushRow(rows, {
        type: 'assistant-thinking',
        key: `assistant-thinking:${message.id}`,
        messageId: message.id,
      });
    }
  }

  return rows;
}

export function getVirtualizedMessageIndex(
  messages: readonly { id?: string; messageId?: string }[],
  messageId: string,
): number {
  for (let index = 0; index < messages.length; index += 1) {
    const item = messages[index];
    if (item?.id === messageId || item?.messageId === messageId) {
      return index;
    }
  }

  return -1;
}

export function registerVirtualMessageRow<TElement extends Element>(
  id: string,
  node: TElement | null,
  registration: VirtualMessageRowRegistration<TElement>,
): void {
  const previousNode = registration.observedRows.get(id);

  if (!node) {
    registration.rowRefs.delete(id);
    if (previousNode) {
      registration.resizeObserver?.unobserve(previousNode);
      registration.observedRows.delete(id);
    }
    return;
  }

  registration.rowRefs.set(id, node);
  if (previousNode !== node) {
    if (previousNode) {
      registration.resizeObserver?.unobserve(previousNode);
    }
    registration.observedRows.set(id, node);
    registration.resizeObserver?.observe(node);
  }
  registration.measureElement(node);
}
