import React from 'react';
import type { Attachment } from '../../types';
import type { UnifiedMessage } from '../../types/unified-message';
import { Tag } from '../ui/tag';
import MessageTimestamp from './MessageTimestamp';
import { getAttachmentKey, isImageAttachment } from './message-item-helpers';

export function OutboundStatusBadge({
  msg,
}: {
  msg: UnifiedMessage;
}): React.ReactElement | null {
  if (msg.channelKind !== 'outbound') return null;

  if (msg.role === 'sent') {
    return (
      <Tag
        tone="success"
        icon={
          <svg
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M13.5 4.5L6 12l-3.5-3.5" />
          </svg>
        }
      >
        SENT
      </Tag>
    );
  }

  if (msg.role === 'sending') {
    return (
      <Tag
        tone="info"
        icon={
          <svg
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="animate-spin"
            aria-hidden="true"
          >
            <path d="M8 2v2M8 12v2M2 8h2M12 8h2" />
          </svg>
        }
      >
        SENDING
      </Tag>
    );
  }

  return (
    <Tag
      tone="warning"
      icon={
        <svg
          width="10"
          height="10"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 8h10" />
          <path d="M8 3v10" opacity="0.35" />
        </svg>
      }
    >
      QUEUED
    </Tag>
  );
}

export function MessageHoverToolbar({
  align = 'right',
  copied,
  onCopyText,
}: {
  align?: 'left' | 'right';
  copied: boolean;
  onCopyText: () => void;
}): React.ReactElement {
  return (
    <div
      className={`pointer-events-none absolute top-full z-10 mt-1 flex gap-1 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 ${align === 'left' ? 'left-0' : 'right-0'}`}
      data-slot="message-hover-toolbar"
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onCopyText();
        }}
        className="inline-flex h-6 items-center gap-1 rounded-md border border-transparent bg-transparent px-1.5 text-[10px] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
        aria-label={copied ? 'Copied message' : 'Copy message'}
        title={copied ? 'Copied' : 'Copy message'}
      >
        {copied ? (
          <>
            <svg
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M13.5 4.5L6 12l-3.5-3.5" />
            </svg>
            Copied
          </>
        ) : (
          <>
            <svg
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="5" y="5" width="9" height="9" rx="1.5" />
              <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
            </svg>
            Copy
          </>
        )}
      </button>
    </div>
  );
}

export function MessageContextMenu({
  hasToolCalls,
  menu,
  onClose,
  onCopyId,
  onCopyLink,
  onCopyRawMessage,
  onCopyText,
  onCopyTools,
}: {
  hasToolCalls: boolean;
  menu: { x: number; y: number } | null;
  onClose: () => void;
  onCopyId: () => void;
  onCopyLink: () => void;
  onCopyRawMessage: () => void;
  onCopyText: () => void;
  onCopyTools: () => void;
}): React.ReactElement | null {
  if (!menu) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Close context menu"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
        className="fixed inset-0 z-40 cursor-default bg-transparent"
      />
      <div
        role="menu"
        aria-label="Message actions"
        className="fixed z-50 min-w-[160px] overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] shadow-lg"
        style={{ left: menu.x, top: menu.y }}
      >
        <MessageMenuButton onClick={onCopyText}>Copy text</MessageMenuButton>
        <MessageMenuButton onClick={onCopyId}>
          Copy message ID
        </MessageMenuButton>
        <MessageMenuButton onClick={onCopyLink}>Copy link</MessageMenuButton>
        <MessageMenuButton onClick={onCopyRawMessage}>
          Copy raw JSON
        </MessageMenuButton>
        {hasToolCalls && (
          <MessageMenuButton onClick={onCopyTools}>
            Copy tool data
          </MessageMenuButton>
        )}
      </div>
    </>
  );
}

function MessageMenuButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="block w-full px-3 py-1.5 text-left text-xs text-[var(--color-text)] transition-colors hover:bg-[var(--color-agent)]/15"
    >
      {children}
    </button>
  );
}

export function MessageMetaRow({
  costInfo,
  isActive,
  outboundBadge,
  show,
}: {
  costInfo: string | null;
  isActive: boolean;
  outboundBadge: React.ReactNode;
  show: boolean;
}): React.ReactElement | null {
  if (!show) return null;

  return (
    <div className="mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-[var(--color-text-faint)]">
      {isActive && (
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-agent)] animate-pulse" />
      )}
      {outboundBadge}
      {costInfo && (
        <>
          <span className="text-[var(--color-text-faint)]/60">•</span>
          <span className="text-[var(--color-text-muted)]">{costInfo}</span>
        </>
      )}
    </div>
  );
}

export function MessageAttachments({
  attachments,
  msgId,
  onImageClick,
  userSide,
}: {
  attachments?: Attachment[];
  msgId: string;
  onImageClick: (attachment: Attachment) => void;
  userSide: boolean;
}): React.ReactElement | null {
  if (!attachments?.length) return null;

  return (
    <div
      className={`mt-2 flex flex-wrap gap-2 ${userSide ? 'justify-end' : ''}`}
    >
      {attachments.map((attachment, index) =>
        isImageAttachment(attachment) ? (
          <button
            key={getAttachmentKey(msgId, attachment, index)}
            type="button"
            onClick={() => onImageClick(attachment)}
            className="h-12 w-12 overflow-hidden rounded-md border border-[var(--color-border-weak)] bg-[var(--color-surface)] transition-colors hover:border-[var(--color-agent)]"
            title={`${attachment.name} — click to expand`}
          >
            <img
              src={`data:${attachment.mimeType};base64,${attachment.data}`}
              alt={attachment.name}
              className="h-full w-full object-cover"
            />
          </button>
        ) : (
          <span
            key={getAttachmentKey(msgId, attachment, index)}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border-weak)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]"
          >
            <span aria-hidden="true">&#128206;</span> {attachment.name}
          </span>
        ),
      )}
    </div>
  );
}

export function MessageFileParts({
  files,
  msgId,
  userSide,
}: {
  files?: UnifiedMessage['fileParts'];
  msgId: string;
  userSide: boolean;
}): React.ReactElement | null {
  if (!files?.length) return null;

  return (
    <div
      className={`mt-2 flex flex-wrap gap-1.5 ${userSide ? 'justify-end' : ''}`}
    >
      {files.map((file, index) => (
        <span
          key={`${msgId}-file-${index}-${file.name}-${file.mimeType ?? ''}`}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border-weak)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]"
          title={file.url ?? file.mimeType ?? file.name}
        >
          <span aria-hidden="true">&#128196;</span>
          <span>{file.mimeType ?? 'file'}</span>
          <span className="text-[var(--color-text-faint)]">{file.name}</span>
        </span>
      ))}
    </div>
  );
}

export function MessageSourceLinks({
  msgId,
  sourceUrls,
}: {
  msgId: string;
  sourceUrls?: UnifiedMessage['sourceUrls'];
}): React.ReactElement | null {
  if (!sourceUrls?.length) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {sourceUrls.map((source, index) => (
        <a
          key={`${msgId}-source-${index}-${source.url}`}
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex max-w-full items-center gap-1 rounded-md border border-[var(--color-border-weak)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] text-[var(--color-agent)] hover:border-[var(--color-agent)]/50"
          title={source.url}
        >
          <span aria-hidden="true">&#128279;</span>
          <span className="truncate">{source.title || source.url}</span>
        </a>
      ))}
    </div>
  );
}

export function HiddenContextNotice({
  count,
}: {
  count?: number;
}): React.ReactElement | null {
  if (!count) return null;

  return (
    <div className="mt-2 text-[10px] text-[var(--color-text-faint)]">
      {count} hidden context part{count === 1 ? '' : 's'} not shown
    </div>
  );
}

export function MessageOptions({
  onSelectOption,
  options,
  show,
}: {
  onSelectOption?: (option: string) => void;
  options?: string[];
  show: boolean;
}): React.ReactElement | null {
  if (!show || !options || !onSelectOption) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onSelectOption(option)}
          className="cursor-pointer rounded-md border border-[var(--color-agent)]/40 bg-[var(--color-agent)]/10 px-3 py-1.5 text-xs font-medium text-[var(--color-agent)] transition-all hover:border-[var(--color-agent)] hover:bg-[var(--color-agent)]/20 active:scale-95"
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export function MessageTimestampLine({
  executionStatus,
  timestamp,
}: {
  executionStatus: string | null;
  timestamp: number;
}): React.ReactElement {
  return (
    <span className="mt-1 block text-[10px] text-[var(--color-text-faint)] opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
      <MessageTimestamp timestamp={new Date(timestamp)} />
      {executionStatus && (
        <>
          <span className="px-1 text-[var(--color-text-faint)]/60">•</span>
          <span>{executionStatus}</span>
        </>
      )}
    </span>
  );
}

export function AssistantErrorBlock({
  error,
  errorName,
  userSide,
}: {
  error?: string;
  errorName?: string;
  userSide: boolean;
}): React.ReactElement | null {
  if (userSide || !error) return null;

  return (
    <div className="mt-2 rounded-md border border-[var(--color-error)]/35 bg-[var(--color-error-surface)]/60 px-2.5 py-2 text-xs text-[var(--color-error)]">
      {errorName === 'MessageAbortedError' ? 'Interrupted' : error}
    </div>
  );
}
