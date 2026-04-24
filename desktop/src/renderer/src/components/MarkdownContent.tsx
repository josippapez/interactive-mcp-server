import { memo, useEffect, useMemo, useRef } from 'react';
import { useTheme } from '../ThemeContext';
import { Response } from './ai-elements/response';
import { getMarkdownProseClasses } from './markdown-renderer';

/**
 * Custom event dispatched when the user clicks a markdown link pointing to
 * an OpenCode attachment. Components that own an image modal (e.g.
 * ChatHistoryView) listen for it and open the modal instead of letting the
 * default navigation trap the user on a bare image URL.
 *
 * Ported verbatim from the old MorphdomMarkdown implementation so
 * ChatHistoryView's existing `interactive-mcp:open-image` listener keeps
 * working unchanged.
 */
const ATTACHMENT_URL_PATTERN = /\/attachments\/[^?#]+\.(png|jpe?g|gif|webp)/i;

interface MarkdownContentProps {
  content: string;
  streaming?: boolean;
}

function MarkdownContentImpl({
  content,
  streaming = false,
}: MarkdownContentProps): React.ReactElement {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const containerRef = useRef<HTMLDivElement>(null);

  const proseClasses = useMemo(() => getMarkdownProseClasses(isDark), [isDark]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Delegate clicks on attachment links so the in-app modal opens instead
    // of navigating the window to the raw asset URL (which leaves the user
    // with no back UI because the app uses hiddenInset + autoHideMenuBar).
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || !ATTACHMENT_URL_PATTERN.test(href)) return;
      event.preventDefault();
      event.stopPropagation();
      const name = anchor.textContent?.replace(/^Image:\s*/i, '') || href;
      window.dispatchEvent(
        new CustomEvent('interactive-mcp:open-image', {
          detail: { src: href, name },
        }),
      );
    };
    container.addEventListener('click', handleClick);
    return () => container.removeEventListener('click', handleClick);
  }, []);

  return (
    <div ref={containerRef} className={proseClasses}>
      <Response isAnimating={streaming}>{content}</Response>
    </div>
  );
}

/**
 * Explicit memo comparator (C7 polish).
 *
 * The default `React.memo` comparator already shallow-compares props, but
 * naming the comparator here makes the skip conditions obvious at a glance
 * and protects against accidental prop additions regressing the skip path:
 *
 *   - If `content` is the same string reference (the reducer returns stable
 *     strings between `message.part.delta` appends), skip re-render.
 *   - If only the `streaming` flag toggled, re-render so the child
 *     `<Response isAnimating>` can stop its caret/tick animation.
 *
 * Any new prop added to `MarkdownContentProps` must be reflected here.
 */
function arePropsEqual(
  prev: MarkdownContentProps,
  next: MarkdownContentProps,
): boolean {
  return prev.content === next.content && prev.streaming === next.streaming;
}

export default memo(MarkdownContentImpl, arePropsEqual);
