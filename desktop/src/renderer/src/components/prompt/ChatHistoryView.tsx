import React, {
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
  memo,
  type RefObject,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useStickToBottom } from 'use-stick-to-bottom';
import type { Attachment, ChannelMessage } from '../../types';
import type { ConversationMessage } from '../../../../preload/index';
import MarkdownContent from '../MarkdownContent';
import MessageTimestamp from './MessageTimestamp';
import DiffView from './DiffView';
import {
  type UnifiedMessage,
  type ToolCallInfo,
  mergeMessages,
} from '../../types/unified-message';
import {
  isEditToolCall,
  isReadToolCall,
  parseEditToolInput,
  parseReadToolInput,
} from '../../lib/diff-parser';

type Props = {
  messages: ChannelMessage[];
  chatEndRef: RefObject<HTMLDivElement | null>;
  activePromptId?: string | null;
  predefinedOptions?: string[];
  onSelectOption?: (option: string) => void;
  /** ID of the last message that was read (unread marker appears after this) */
  lastReadMessageId?: string | null;
  /** Conversation messages from provider (optional - for OpenCode sessions) */
  conversationMessages?: ConversationMessage[];
  /** Whether to show conversation messages (provider capability flag) */
  showConversation?: boolean;
  /** Whether to expand all tool calls by default */
  expandAllTools?: boolean;
  /** List of tool names to exclude from auto-expand */
  toolAutoExpandExclusions?: string[];
  /** Callback when a new tool is discovered (for settings) */
  onToolDiscovered?: (toolName: string) => void;
};

// ---------------------------------------------------------------------------
// Helper functions (pure, no dependencies on component state)
// ---------------------------------------------------------------------------

/**
 * Get role label for unified messages.
 * @param msg - The unified message to get a label for
 * @returns A human-readable role label
 */
function unifiedRoleLabel(msg: UnifiedMessage): string {
  if (msg.source === 'channel') {
    // Use channel-specific labels
    if (msg.channelKind === 'answer') return 'You';
    if (msg.channelKind === 'outbound')
      return msg.role === 'sent' ? 'Sent' : 'Queued';
    if (msg.channelKind === 'agent_message') return 'Agent';
    return 'Agent';
  }
  // Conversation messages
  if (msg.role === 'user') return 'You';
  if (msg.role === 'system') return 'System';
  if (msg.agent) return msg.agent.charAt(0).toUpperCase() + msg.agent.slice(1);
  return 'Assistant';
}

/**
 * Get CSS class for unified message styling.
 * @param msg - The unified message to get a class for
 * @returns CSS class name for styling
 */
function unifiedMessageClass(msg: UnifiedMessage): string {
  if (msg.source === 'channel') {
    if (msg.channelKind === 'answer' || msg.channelKind === 'outbound')
      return 'msg-user';
    if (msg.channelKind === 'agent_message') return 'msg-agent-info';
    return 'msg-agent';
  }
  // Conversation messages
  if (msg.role === 'user') return 'msg-user';
  if (msg.role === 'system') return 'msg-system';
  return 'msg-conversation';
}

/**
 * Check if an attachment is a displayable image.
 * @param att - The attachment to check
 * @returns true if the attachment is an image with data
 */
function isImageAttachment(att: Attachment): boolean {
  return att.mimeType.startsWith('image/') && att.data.length > 0;
}

/**
 * Format token count for display.
 * @param tokens - Token usage object
 * @returns Formatted token string or null
 */
function formatTokens(tokens?: UnifiedMessage['tokens']): string | null {
  if (!tokens) return null;
  if (tokens.total) return `${tokens.total.toLocaleString()} tokens`;
  if (tokens.input || tokens.output) {
    const parts: string[] = [];
    if (tokens.input) parts.push(`${tokens.input.toLocaleString()} in`);
    if (tokens.output) parts.push(`${tokens.output.toLocaleString()} out`);
    return parts.join(' / ');
  }
  return null;
}

/**
 * Format cost for display.
 * @param cost - Cost in USD
 * @returns Formatted cost string or null
 */
function formatCost(cost?: number): string | null {
  if (cost == null || cost === 0) return null;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Sub-components (extracted for memoization)
// ---------------------------------------------------------------------------

/**
 * Unread divider component that appears between read and unread messages.
 */
const UnreadDivider = memo(function UnreadDivider(): React.ReactElement {
  return (
    <div className="flex items-center gap-2 py-2 my-1">
      <div className="flex-1 h-px bg-[var(--color-error)]/40" />
      <span className="text-[10px] uppercase tracking-wide text-[var(--color-error)] font-medium px-2">
        New messages
      </span>
      <div className="flex-1 h-px bg-[var(--color-error)]/40" />
    </div>
  );
});

/**
 * Status badge for tool calls.
 */
const ToolStatusBadge = memo(function ToolStatusBadge({
  status,
}: {
  status?: 'pending' | 'running' | 'completed' | 'error';
}): React.ReactElement {
  const statusStyles = {
    pending: 'bg-[var(--color-text-muted)]/20 text-[var(--color-text-muted)]',
    running: 'bg-[var(--color-agent)]/20 text-[var(--color-agent)]',
    completed:
      'bg-[var(--color-success)]/20 text-[var(--color-success,#22c55e)]',
    error: 'bg-[var(--color-error)]/20 text-[var(--color-error)]',
  };

  const statusLabels = {
    pending: 'Pending',
    running: 'Running',
    completed: 'Done',
    error: 'Error',
  };

  const style = status ? statusStyles[status] : statusStyles.pending;
  const label = status ? statusLabels[status] : 'Unknown';

  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${style}`}>
      {status === 'running' && (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse mr-1" />
      )}
      {label}
    </span>
  );
});

/**
 * Extract a short summary from tool input for display in the header.
 * Returns the most relevant field (file path, command, query, etc.)
 */
function getToolInputSummary(
  toolName: string,
  input: Record<string, unknown> | undefined,
): string | null {
  if (!input) return null;

  // Common patterns for tool inputs
  const pathFields = [
    'filePath',
    'path',
    'file',
    'directory',
    'dir',
    'workdir',
  ];
  const commandFields = ['command', 'cmd', 'script'];
  const queryFields = ['query', 'pattern', 'search', 'name'];
  const urlFields = ['url', 'uri', 'endpoint'];

  // Check for path-like fields first
  for (const field of pathFields) {
    if (typeof input[field] === 'string' && input[field]) {
      return input[field] as string;
    }
  }

  // Check for command fields
  for (const field of commandFields) {
    if (typeof input[field] === 'string' && input[field]) {
      const cmd = input[field] as string;
      // Truncate long commands
      return cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
    }
  }

  // Check for query fields
  for (const field of queryFields) {
    if (typeof input[field] === 'string' && input[field]) {
      const q = input[field] as string;
      return q.length > 50 ? q.slice(0, 47) + '...' : q;
    }
  }

  // Check for URL fields
  for (const field of urlFields) {
    if (typeof input[field] === 'string' && input[field]) {
      return input[field] as string;
    }
  }

  // For TodoWrite, show the count
  if (
    toolName.toLowerCase().includes('todo') &&
    Array.isArray(input['todos'])
  ) {
    return `${input['todos'].length} items`;
  }

  return null;
}

/**
 * Format tool input as a compact key-value list.
 */
function formatInputCompact(input: Record<string, unknown>): string {
  const entries = Object.entries(input);
  if (entries.length === 0) return '';

  return entries
    .map(([key, value]) => {
      let displayValue: string;
      if (typeof value === 'string') {
        // Truncate long strings
        displayValue = value.length > 100 ? value.slice(0, 97) + '...' : value;
      } else if (Array.isArray(value)) {
        displayValue = `[${value.length} items]`;
      } else if (typeof value === 'object' && value !== null) {
        displayValue = '{...}';
      } else {
        displayValue = String(value);
      }
      return `${key}: ${displayValue}`;
    })
    .join('\n');
}

/**
 * Component to render a single tool call.
 * Memoized to prevent re-renders when parent updates.
 */
const ToolCallView = memo(function ToolCallView({
  tool,
  forceExpanded = false,
}: {
  tool: ToolCallInfo;
  /** When true, start expanded (for "expand all tools" toggle) */
  forceExpanded?: boolean;
}): React.ReactElement {
  const [isExpanded, setIsExpanded] = useState(forceExpanded);
  const [showFullInput, setShowFullInput] = useState(false);

  // Sync with forceExpanded prop when it changes
  useEffect(() => {
    setIsExpanded(forceExpanded);
  }, [forceExpanded]);

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const toggleFullInput = useCallback(() => {
    setShowFullInput((prev) => !prev);
  }, []);

  // Check tool types for specialized rendering
  const isEdit = isEditToolCall(tool.name);
  const isRead = isReadToolCall(tool.name);

  // Extract file paths for display
  const editInput = isEdit ? parseEditToolInput(tool.input) : null;
  const readFilePath = isRead ? parseReadToolInput(tool.input) : null;

  // Get a summary for the header
  const inputSummary = getToolInputSummary(tool.name, tool.input);
  const hasInput = tool.input && Object.keys(tool.input).length > 0;
  const hasOutput = Boolean(tool.output);

  // Read tool: render as a compact single line (no expand)
  if (isRead && readFilePath) {
    return (
      <div className="mt-1 flex items-center gap-2 px-2 py-1 rounded bg-[var(--color-surface)] border border-[var(--color-border)]">
        <span className="text-[var(--color-tool)] font-mono text-[10px]">
          {tool.name}
        </span>
        <span className="text-[var(--color-text-muted)] font-mono text-[11px] truncate flex-1">
          {readFilePath}
        </span>
        <ToolStatusBadge status={tool.status} />
      </div>
    );
  }

  // Edit tool: show file path in header, diff in expanded section
  if (isEdit && editInput) {
    return (
      <div className="mt-2 border border-[var(--color-border)] rounded-md overflow-hidden bg-[var(--color-surface)]">
        <button
          type="button"
          onClick={toggleExpanded}
          className="w-full px-3 py-1.5 flex items-center justify-between text-left hover:bg-[var(--color-border)]/30 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-[var(--color-tool)] font-mono text-[10px] shrink-0">
              {tool.name}
            </span>
            <span className="text-[var(--color-text-muted)] font-mono text-[11px] truncate">
              {editInput.filePath}
            </span>
            <ToolStatusBadge status={tool.status} />
          </div>
          <span className="text-[var(--color-text-muted)] text-xs shrink-0 ml-2">
            {isExpanded ? '▼' : '▶'}
          </span>
        </button>

        {isExpanded && (
          <div className="border-t border-[var(--color-border)]">
            <DiffView tool={tool} />
          </div>
        )}
      </div>
    );
  }

  // Default: other tools with compact input/output display
  return (
    <div className="mt-1 border border-[var(--color-border)] rounded-md overflow-hidden bg-[var(--color-surface)]">
      {/* Header */}
      <button
        type="button"
        onClick={toggleExpanded}
        className="w-full px-2 py-1 flex items-center justify-between text-left hover:bg-[var(--color-border)]/30 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-[var(--color-tool)] font-mono text-[10px] shrink-0">
            {tool.name}
          </span>
          {inputSummary && (
            <span className="text-[var(--color-text-muted)] font-mono text-[10px] truncate">
              {inputSummary}
            </span>
          )}
          <ToolStatusBadge status={tool.status} />
        </div>
        <span className="text-[var(--color-text-muted)] text-[10px] shrink-0 ml-2">
          {isExpanded ? '▼' : '▶'}
        </span>
      </button>

      {/* Expanded content */}
      {isExpanded && (hasInput || hasOutput) && (
        <div className="border-t border-[var(--color-border)]">
          {/* Input section - compact by default */}
          {hasInput && (
            <div className="border-b border-[var(--color-border)]/50">
              <button
                type="button"
                onClick={toggleFullInput}
                className="w-full px-2 py-1 flex items-center gap-2 text-left hover:bg-[var(--color-border)]/20 transition-colors cursor-pointer"
              >
                <span className="text-[9px] uppercase tracking-wide text-[var(--color-text-faint)] font-medium">
                  Input
                </span>
                <span className="text-[9px] text-[var(--color-text-faint)]">
                  {showFullInput ? '(hide)' : '(show)'}
                </span>
              </button>
              {showFullInput && (
                <pre className="px-2 pb-2 text-[10px] font-mono text-[var(--color-text-muted)] bg-[var(--color-background)]/50 overflow-x-auto max-h-32 whitespace-pre-wrap">
                  {formatInputCompact(tool.input!)}
                </pre>
              )}
            </div>
          )}

          {/* Output section - always visible when present */}
          {hasOutput && (
            <div className="px-2 py-1.5">
              <div className="text-[9px] uppercase tracking-wide text-[var(--color-success,#22c55e)] font-medium mb-1">
                Output
              </div>
              <pre className="text-[10px] font-mono text-[var(--color-text)] bg-[var(--color-background)] p-2 rounded overflow-x-auto max-h-48 whitespace-pre-wrap border-l-2 border-[var(--color-success,#22c55e)]/40">
                {tool.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

/**
 * Props for the MessageItem component.
 */
interface MessageItemProps {
  msg: UnifiedMessage;
  isActive: boolean;
  showOptions: boolean;
  predefinedOptions?: string[];
  onSelectOption?: (option: string) => void;
  onExpandImage: (src: string, name: string) => void;
  /** Whether to expand all tool calls by default */
  expandAllTools?: boolean;
  /** List of tool names to exclude from auto-expand */
  toolAutoExpandExclusions?: string[];
}

/**
 * Memoized component for rendering a single message.
 * Extracts the message rendering logic to prevent re-renders of all messages
 * when only one message changes.
 */
const MessageItem = memo(function MessageItem({
  msg,
  isActive,
  showOptions,
  predefinedOptions,
  onSelectOption,
  onExpandImage,
  expandAllTools,
  toolAutoExpandExclusions = [],
}: MessageItemProps): React.ReactElement {
  const tokenInfo = formatTokens(msg.tokens);
  const costInfo = formatCost(msg.cost);

  // Memoize the image click handler to avoid creating new functions on each render
  const handleImageClick = useCallback(
    (attachment: Attachment) => {
      onExpandImage(
        `data:${attachment.mimeType};base64,${attachment.data}`,
        attachment.name,
      );
    },
    [onExpandImage],
  );

  return (
    <div
      className={`pl-3 py-2 text-sm msg-enter ${unifiedMessageClass(msg)} ${
        isActive
          ? 'border-l-2 border-[var(--color-agent)] bg-[var(--color-agent)]/5'
          : ''
      } ${
        msg.source === 'conversation'
          ? 'border-l border-[var(--color-tool)]/30'
          : ''
      }`}
    >
      {/* Header row */}
      <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] flex items-center gap-1.5 flex-wrap">
        {isActive && (
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-agent)] animate-pulse inline-block" />
        )}
        <span>{unifiedRoleLabel(msg)}</span>
        <span>•</span>
        <MessageTimestamp timestamp={new Date(msg.timestamp)} />

        {/* Conversation-specific metadata */}
        {msg.source === 'conversation' && msg.modelId && (
          <>
            <span>•</span>
            <span className="font-mono text-[var(--color-text-muted)]">
              {msg.modelId}
            </span>
          </>
        )}

        {tokenInfo && (
          <>
            <span>•</span>
            <span className="text-[var(--color-text-muted)]">{tokenInfo}</span>
          </>
        )}

        {costInfo && (
          <>
            <span>•</span>
            <span className="text-[var(--color-success,#22c55e)]">
              {costInfo}
            </span>
          </>
        )}

        {/* Source indicator for conversation messages */}
        {msg.source === 'conversation' && (
          <span className="ml-auto px-1 py-0.5 rounded text-[8px] bg-[var(--color-tool)]/10 text-[var(--color-tool)]">
            OpenCode
          </span>
        )}
      </div>

      {/* Text content */}
      {msg.text && <MarkdownContent content={msg.text} />}

      {/* Tool calls (conversation messages) */}
      {msg.toolCalls && msg.toolCalls.length > 0 && (
        <div className="mt-2 space-y-1">
          {msg.toolCalls.map((tool) => {
            // Check if this tool is excluded from auto-expand
            const isExcluded = toolAutoExpandExclusions.includes(tool.name);
            const shouldExpand = expandAllTools && !isExcluded;
            return (
              <ToolCallView
                key={tool.id}
                tool={tool}
                forceExpanded={shouldExpand}
              />
            );
          })}
        </div>
      )}

      {/* Attachments (channel messages) */}
      {msg.attachments && msg.attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {msg.attachments.map((attachment, idx) =>
            isImageAttachment(attachment) ? (
              <button
                key={`${msg.id}-att-${idx}`}
                type="button"
                onClick={() => handleImageClick(attachment)}
                className="w-20 h-20 rounded-sm border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)] cursor-pointer hover:border-[var(--color-agent)] transition-colors"
                title={`${attachment.name} — click to expand`}
              >
                <img
                  src={`data:${attachment.mimeType};base64,${attachment.data}`}
                  alt={attachment.name}
                  className="w-full h-full object-cover"
                />
              </button>
            ) : (
              <span
                key={`${msg.id}-att-${idx}`}
                className="px-1.5 py-0.5 rounded-sm text-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)] inline-flex items-center gap-1"
              >
                <span aria-hidden="true">&#128206;</span> {attachment.name}
              </span>
            ),
          )}
        </div>
      )}

      {/* Predefined options for active prompts */}
      {showOptions && predefinedOptions && onSelectOption && (
        <div className="mt-3 flex flex-wrap gap-2">
          {predefinedOptions.map((option) => (
            <button
              key={option}
              onClick={() => onSelectOption(option)}
              className="px-3 py-1.5 rounded-md border border-[var(--color-agent)]/40 bg-[var(--color-agent)]/10 text-xs font-medium text-[var(--color-agent)] hover:bg-[var(--color-agent)]/20 hover:border-[var(--color-agent)] active:scale-95 transition-all cursor-pointer"
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

/**
 * Image modal for displaying expanded image attachments.
 */
const ImageModal = memo(function ImageModal({
  image,
  onClose,
}: {
  image: { src: string; name: string };
  onClose: () => void;
}): React.ReactElement {
  const handleBackdropClick = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleContentClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={handleBackdropClick}
    >
      <div
        className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center"
        onClick={handleContentClick}
      >
        <div className="flex items-center justify-between w-full mb-2 px-1">
          <span className="text-xs text-white/70 truncate max-w-[80%]">
            {image.name}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-white/70 hover:text-white text-sm px-2 py-0.5"
            aria-label="Close image preview"
          >
            ESC
          </button>
        </div>
        <img
          src={image.src}
          alt={image.name}
          className="max-w-full max-h-[85vh] rounded-sm object-contain"
        />
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Chat history view component for displaying unified messages.
 *
 * Uses virtualization for performance with large message lists.
 * Renders channel messages and conversation messages in a unified timeline,
 * with support for:
 * - Unread message dividers
 * - Auto-scrolling to new messages
 * - Image attachment previews
 * - Tool call display
 * - Active prompt highlighting
 */
export default function ChatHistoryView({
  messages,
  chatEndRef,
  activePromptId,
  predefinedOptions,
  onSelectOption,
  lastReadMessageId,
  conversationMessages = [],
  showConversation = false,
  expandAllTools = false,
  toolAutoExpandExclusions = [],
}: Props): React.ReactElement {
  const [expandedImage, setExpandedImage] = useState<{
    src: string;
    name: string;
  } | null>(null);

  // Use stick-to-bottom for auto-scroll behavior
  // This hook handles all the scroll tracking and auto-scroll logic
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } =
    useStickToBottom({
      // Spring animation parameters for smooth scrolling
      resize: 'smooth',
      initial: 'instant', // Instant scroll on mount
    });

  // We need a local ref for the virtualizer since it needs to call getScrollElement
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Combine refs: both useStickToBottom and virtualizer need the scroll container
  const setScrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollContainerRef.current = node;
      // Assign to useStickToBottom's scrollRef
      if (typeof scrollRef === 'function') {
        scrollRef(node);
      } else if (scrollRef) {
        (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current =
          node;
      }
    },
    [scrollRef],
  );

  // Merge channel and conversation messages if showConversation is enabled
  const unifiedMessages = useMemo(() => {
    if (showConversation && conversationMessages.length > 0) {
      return mergeMessages(messages, conversationMessages, activePromptId);
    }
    // Just convert channel messages without merging
    return mergeMessages(messages, [], activePromptId);
  }, [messages, conversationMessages, showConversation, activePromptId]);

  // Memoize unread divider calculations
  const { unreadStartIndex, showUnreadDivider } = useMemo(() => {
    const startIndex =
      lastReadMessageId != null
        ? unifiedMessages.findIndex((m) => m.id === lastReadMessageId) + 1
        : -1;

    return {
      unreadStartIndex: startIndex,
      showUnreadDivider: startIndex > 0 && startIndex < unifiedMessages.length,
    };
  }, [unifiedMessages, lastReadMessageId]);

  // Virtualizer for efficient rendering of large message lists
  const virtualizer = useVirtualizer({
    count: unifiedMessages.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 100, // Estimated message height in pixels
    overscan: 5, // Render 5 extra items above/below viewport
  });

  // Stable callback for expanding images (passed to memoized MessageItem)
  const handleExpandImage = useCallback((src: string, name: string) => {
    setExpandedImage({ src, name });
  }, []);

  // Stable callback for closing the image modal
  const handleCloseImage = useCallback(() => {
    setExpandedImage(null);
  }, []);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <>
      <div
        ref={setScrollRef}
        className="flex-1 overflow-y-auto px-4 py-3"
        style={{ contain: 'strict' }}
      >
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
            {virtualItems.map((virtualRow) => {
              const msg = unifiedMessages[virtualRow.index];
              const isActive = msg.isActivePrompt ?? false;
              const showOptions = Boolean(
                isActive &&
                predefinedOptions &&
                predefinedOptions.length > 0 &&
                onSelectOption,
              );

              // Show unread divider before the first unread message
              const showDividerBefore =
                showUnreadDivider && virtualRow.index === unreadStartIndex;

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
                    onExpandImage={handleExpandImage}
                    expandAllTools={expandAllTools}
                    toolAutoExpandExclusions={toolAutoExpandExclusions}
                  />
                </div>
              );
            })}
          </div>
        </div>
        <div ref={chatEndRef} />
      </div>

      {/* Scroll to bottom button - shows when user scrolls away from bottom */}
      {!isAtBottom && (
        <button
          type="button"
          onClick={() => scrollToBottom('smooth')}
          className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full bg-[var(--color-background-secondary)] border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] shadow-lg hover:bg-[var(--color-background-tertiary)] hover:text-[var(--color-text-primary)] transition-all"
          aria-label="Scroll to bottom"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-4 h-4"
          >
            <path
              fillRule="evenodd"
              d="M10 3a.75.75 0 01.75.75v10.638l3.96-4.158a.75.75 0 111.08 1.04l-5.25 5.5a.75.75 0 01-1.08 0l-5.25-5.5a.75.75 0 111.08-1.04l3.96 4.158V3.75A.75.75 0 0110 3z"
              clipRule="evenodd"
            />
          </svg>
          New messages
        </button>
      )}

      {/* Expanded image modal */}
      {expandedImage && (
        <ImageModal image={expandedImage} onClose={handleCloseImage} />
      )}
    </>
  );
}
