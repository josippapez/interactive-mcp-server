'use client';

import { cjk } from '@streamdown/cjk';
import { code } from '@streamdown/code';
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import type { ComponentProps, ReactNode } from 'react';
import { memo } from 'react';
import { createPortal } from 'react-dom';
import { Streamdown } from 'streamdown';
import type { LinkSafetyConfig, LinkSafetyModalProps } from 'streamdown';
import { cn } from '../../lib/utils';

export type ResponseProps = ComponentProps<typeof Streamdown>;

const streamdownPlugins = { cjk, code, math, mermaid };

/**
 * Shiki theme pair used across the app (CodeBlock, DiffView, and markdown
 * code blocks inside assistant messages). Keeping a single source of truth
 * ensures token colors line up with our dual-theme Shiki caches.
 */
const SHIKI_THEMES: [string, string] = ['github-light', 'github-dark'];

const linkSafety: LinkSafetyConfig = {
  enabled: true,
  renderModal: (props) => <LinkSafetyPortalModal {...props} />,
};

function LinkSafetyPortalModal({
  isOpen,
  onClose,
  onConfirm,
  url,
}: LinkSafetyModalProps): ReactNode {
  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-surface)]/50 backdrop-blur-sm"
      data-streamdown="link-safety-modal"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      role="button"
      tabIndex={0}
    >
      <div
        className="relative mx-4 flex w-full max-w-md flex-col gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-[var(--color-text)] shadow-lg"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        role="presentation"
      >
        <button
          className="absolute right-4 top-4 rounded-md p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
          onClick={onClose}
          title="Close"
          type="button"
        >
          <svg
            aria-hidden="true"
            fill="none"
            height="16"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="16"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
          <span className="sr-only">Close</span>
        </button>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <svg
              aria-hidden="true"
              fill="none"
              height="20"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              width="20"
            >
              <path d="M15 3h6v6" />
              <path d="M10 14 21 3" />
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            </svg>
            <span>Open external link?</span>
          </div>
          <p className="text-sm text-[var(--color-text-muted)]">
            You're about to visit an external website.
          </p>
        </div>
        <div className="max-h-32 overflow-y-auto break-all rounded-md bg-[var(--color-surface-alt)] p-3 font-mono text-sm">
          {url}
        </div>
        <div className="flex gap-2">
          <button
            className="flex flex-1 items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--color-border)]"
            onClick={() => void navigator.clipboard.writeText(url)}
            type="button"
          >
            Copy link
          </button>
          <button
            className="flex flex-1 items-center justify-center gap-2 rounded-md bg-[var(--color-agent)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            type="button"
          >
            Open link
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Streaming-aware markdown renderer. Thin wrapper over `Streamdown` (the
 * engine that powers AI Elements' `MessageResponse`) — heals unterminated
 * code fences and tables during token streaming without flicker.
 *
 * Memoized on `children` and `isAnimating` to match the AI Elements
 * reference implementation.
 */
export const Response = memo(
  ({ className, lineNumbers, shikiTheme, ...props }: ResponseProps) => (
    <Streamdown
      className={cn(
        'size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        className,
      )}
      lineNumbers={lineNumbers ?? false}
      plugins={streamdownPlugins}
      linkSafety={linkSafety}
      shikiTheme={
        shikiTheme ??
        (SHIKI_THEMES as unknown as ComponentProps<
          typeof Streamdown
        >['shikiTheme'])
      }
      {...props}
    />
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    nextProps.isAnimating === prevProps.isAnimating,
);

Response.displayName = 'Response';
