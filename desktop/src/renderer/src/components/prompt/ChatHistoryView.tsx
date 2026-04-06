import { useState, type RefObject } from 'react';
import type { Attachment, ChannelMessage } from '../../types';
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
  if (msg.kind === 'outbound') return msg.sent ? 'Sent' : 'Queued';
  if (msg.kind === 'agent_message') return 'Agent';
  return 'Agent';
}

function messageClass(kind: ChannelMessage['kind']): string {
  if (kind === 'answer' || kind === 'outbound') return 'msg-user';
  if (kind === 'agent_message') return 'msg-agent-info';
  return 'msg-agent';
}

function isImageAttachment(att: Attachment): boolean {
  return att.mimeType.startsWith('image/') && att.data.length > 0;
}

export default function ChatHistoryView({
  messages,
  chatEndRef,
  activePromptId,
  predefinedOptions,
  onSelectOption,
}: Props): React.ReactElement {
  const [expandedImage, setExpandedImage] = useState<{
    src: string;
    name: string;
  } | null>(null);

  return (
    <>
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
              className={`pl-3 py-2 text-sm msg-enter ${messageClass(msg.kind)} ${
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
                <div className="mt-2 flex flex-wrap gap-2">
                  {msg.attachments.map((attachment, idx) =>
                    isImageAttachment(attachment) ? (
                      <button
                        key={`${msg.id}-att-${idx}`}
                        type="button"
                        onClick={() =>
                          setExpandedImage({
                            src: `data:${attachment.mimeType};base64,${attachment.data}`,
                            name: attachment.name,
                          })
                        }
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
                        <span aria-hidden="true">&#128206;</span>{' '}
                        {attachment.name}
                      </span>
                    ),
                  )}
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

      {/* Expanded image modal */}
      {expandedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setExpandedImage(null)}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between w-full mb-2 px-1">
              <span className="text-xs text-white/70 truncate max-w-[80%]">
                {expandedImage.name}
              </span>
              <button
                type="button"
                onClick={() => setExpandedImage(null)}
                className="text-white/70 hover:text-white text-sm px-2 py-0.5"
                aria-label="Close image preview"
              >
                ESC
              </button>
            </div>
            <img
              src={expandedImage.src}
              alt={expandedImage.name}
              className="max-w-full max-h-[85vh] rounded-sm object-contain"
            />
          </div>
        </div>
      )}
    </>
  );
}
