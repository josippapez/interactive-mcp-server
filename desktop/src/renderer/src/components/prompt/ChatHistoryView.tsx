import type { RefObject } from 'react';
import type { ChannelMessage } from '../../types';
import MarkdownContent from '../MarkdownContent';

type Props = {
  messages: ChannelMessage[];
  chatEndRef: RefObject<HTMLDivElement | null>;
  activePromptId?: string | null;
  predefinedOptions?: string[];
  onSelectOption?: (option: string) => void;
};

function roleLabel(msg: ChannelMessage): string {
  if (msg.kind === 'answer') return 'You';
  if (msg.kind === 'outbound') return msg.sent ? 'Sent ✓' : 'Queued';
  if (msg.kind === 'agent_message') return 'Agent';
  return 'Agent';
}

function messageClass(kind: ChannelMessage['kind']): string {
  if (kind === 'answer' || kind === 'outbound') return 'msg-user';
  if (kind === 'agent_message') return 'msg-agent-info';
  return 'msg-agent';
}

export default function ChatHistoryView({
  messages,
  chatEndRef,
  activePromptId,
  predefinedOptions,
  onSelectOption,
}: Props): React.ReactElement {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
      {messages.map((msg) => {
        const isActive = msg.id === activePromptId;
        const showOptions =
          isActive &&
          predefinedOptions &&
          predefinedOptions.length > 0 &&
          onSelectOption;

        return (
          <div
            key={msg.id}
            className={`pl-3 py-2 text-sm ${messageClass(msg.kind)} ${
              isActive
                ? 'border-l-2 border-[var(--color-agent)] bg-[var(--color-agent)]/5'
                : ''
            }`}
          >
            <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] flex items-center gap-1.5">
              {isActive && (
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-agent)] animate-pulse inline-block" />
              )}
              {roleLabel(msg)} •{' '}
              {msg.timestamp.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
            <MarkdownContent content={msg.text} />
            {msg.attachments && msg.attachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {msg.attachments.map((attachment, idx) => (
                  <span
                    key={`${msg.id}-att-${idx}`}
                    className="px-1.5 py-0.5 rounded-sm text-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)]"
                  >
                    📎 {attachment.name}
                  </span>
                ))}
              </div>
            )}
            {showOptions && (
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
      })}
      <div ref={chatEndRef} />
    </div>
  );
}
