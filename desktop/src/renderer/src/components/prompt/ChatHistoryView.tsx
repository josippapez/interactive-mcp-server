import type { RefObject } from 'react';
import type { ChannelMessage } from '../../types';
import MarkdownContent from '../MarkdownContent';

type Props = {
  messages: ChannelMessage[];
  chatEndRef: RefObject<HTMLDivElement | null>;
};

function roleLabel(kind: ChannelMessage['kind']): string {
  if (kind === 'answer') return 'You';
  if (kind === 'outbound') return 'Queued';
  return 'Agent';
}

export default function ChatHistoryView({
  messages,
  chatEndRef,
}: Props): React.ReactElement {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`pl-3 py-2 text-sm ${
            msg.kind === 'answer' || msg.kind === 'outbound'
              ? 'msg-user'
              : 'msg-agent'
          }`}
        >
          <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">
            {roleLabel(msg.kind)} •{' '}
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
        </div>
      ))}
      <div ref={chatEndRef} />
    </div>
  );
}
