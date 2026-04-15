import React, { memo, useEffect, useMemo } from 'react';
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import type { UnifiedMessage } from '../../../types/unified-message';
import MessageItem from '../MessageItem';
import UnreadDivider from './UnreadDivider';
import {
  getStreamingMessageId,
  useSeenMessageIds,
} from './virtualized-message-list-helpers';

interface VirtualizedMessageListProps {
  /** Messages to render */
  messages: UnifiedMessage[];
  /** Ref to the scroll container element */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  /** Ref callback for the content wrapper (for height measurement and auto-scroll) */
  contentRef:
    | React.RefCallback<HTMLDivElement>
    | React.RefObject<HTMLDivElement | null>;
  /** Index of first unread message (-1 if none) */
  unreadStartIndex: number;
  /** Whether to show the unread divider */
  showUnreadDivider: boolean;
  /** Predefined options for active prompts */
  predefinedOptions?: string[];
  /** Callback when a predefined option is selected */
  onSelectOption?: (option: string) => void;
  /** Callback when an image is expanded */
  onExpandImage: (src: string, name: string) => void;
  /** Whether to expand all tool calls by default */
  expandAllTools?: boolean;
  /** List of tool names to exclude from auto-expand */
  toolAutoExpandExclusions?: string[];
  /** Callback to navigate to a session by openCodeSessionId */
  onNavigateToSession?: (sessionId: string) => void;
  /** Whether to show thinking sections expanded by default */
  showThinking?: boolean;
  /** Whether list should stay pinned to the latest message */
  followOutput?: boolean;
  /** Estimated size of each message row in pixels */
  estimateSize?: number;
  /** Number of items to render outside the visible area */
  overscan?: number;
}

const VirtualizedMessageList = memo(function VirtualizedMessageList({
  messages,
  scrollContainerRef,
  contentRef,
  unreadStartIndex,
  showUnreadDivider,
  predefinedOptions,
  onSelectOption,
  onExpandImage,
  expandAllTools = false,
  toolAutoExpandExclusions = [],
  onNavigateToSession,
  showThinking = false,
  followOutput = true,
  estimateSize = 100,
  overscan = 5,
}: VirtualizedMessageListProps): React.ReactElement {
  const newMessageIds = useSeenMessageIds(messages);
  const streamingMessageId = useMemo(
    () => getStreamingMessageId(messages),
    [messages],
  );

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: (index) => {
      const msg = messages[index];
      if (!msg) return index;
      const compactionFlag = msg.isCompaction ? 'c' : '';
      const reasoningFlag = msg.reasoning ? 'r' : '';
      return `${msg.id}-${compactionFlag}${reasoningFlag}`;
    },
  });

  const latestMessageSignature = useMemo(() => {
    const latestMessage = messages[messages.length - 1];
    if (!latestMessage) return '';

    return [
      latestMessage.id,
      latestMessage.text,
      latestMessage.reasoning ?? '',
      latestMessage.toolCalls
        ?.map((toolCall) => `${toolCall.id}:${toolCall.status ?? ''}`)
        .join('|') ?? '',
    ].join('::');
  }, [messages]);

  useEffect(() => {
    if (!followOutput || messages.length === 0) return;
    virtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
  }, [followOutput, latestMessageSignature, messages.length, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={contentRef}
      style={{
        height: virtualizer.getTotalSize(),
        width: '100%',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          transform: `translateY(${virtualItems[0]?.start ?? 0}px)`,
        }}
      >
        {virtualItems.map((virtualRow: VirtualItem) => {
          const msg = messages[virtualRow.index];
          if (!msg) return null;

          const isActive = msg.isActivePrompt ?? false;
          const showOptions = Boolean(
            isActive &&
            predefinedOptions &&
            predefinedOptions.length > 0 &&
            onSelectOption,
          );

          const showDividerBefore =
            showUnreadDivider && virtualRow.index === unreadStartIndex;

          const isNewMessage = newMessageIds.has(msg.id);
          const isStreamingMessage = msg.id === streamingMessageId;

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="pb-2"
            >
              {showDividerBefore && <UnreadDivider />}
              <MessageItem
                msg={msg}
                isActive={isActive}
                showOptions={showOptions}
                predefinedOptions={predefinedOptions}
                onSelectOption={onSelectOption}
                onExpandImage={onExpandImage}
                expandAllTools={expandAllTools}
                toolAutoExpandExclusions={toolAutoExpandExclusions}
                onNavigateToSession={onNavigateToSession}
                showThinking={showThinking}
                isNew={isNewMessage}
                isStreaming={isStreamingMessage}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default VirtualizedMessageList;
