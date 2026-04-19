import React, { useRef, useEffect, memo, useMemo } from 'react';
import morphdom from 'morphdom';
import { renderToString } from 'react-dom/server';
import { useTheme } from '../ThemeContext';
import { getMarkdownProseClasses, renderMarkdown } from './markdown-renderer';

interface MorphdomMarkdownProps {
  content: string;
  streaming?: boolean;
  className?: string;
}

/**
 * Custom event dispatched when the user clicks a markdown link pointing to
 * an OpenCode attachment. Components that own an image modal (e.g.
 * ChatHistoryView) can listen for it and open the modal instead of letting
 * the default navigation trap the user on a bare image URL.
 */
const ATTACHMENT_URL_PATTERN = /\/attachments\/[^?#]+\.(png|jpe?g|gif|webp)/i;

function generateMarkdownHtml(content: string, isDark: boolean): string {
  return renderToString(renderMarkdown(content, isDark));
}

const MorphdomMarkdown = memo(function MorphdomMarkdown({
  content,
  streaming = false,
  className = '',
}: MorphdomMarkdownProps): React.ReactElement {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const containerRef = useRef<HTMLDivElement>(null);
  const lastContentRef = useRef<string>('');
  const initializedRef = useRef(false);

  const proseClasses = useMemo(
    () => getMarkdownProseClasses(isDark, className),
    [isDark, className],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Intercept clicks on attachment links so they open the in-app image
    // modal instead of navigating the window to the raw asset URL (which
    // leaves the user with no back UI because the app uses hiddenInset +
    // autoHideMenuBar). Dispatches a CustomEvent on window that the
    // ChatHistoryView listens for.
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (content === lastContentRef.current) return;

    lastContentRef.current = content;
    const nextHtml = generateMarkdownHtml(content, isDark);

    if (!initializedRef.current || !streaming) {
      initializedRef.current = true;
      if (container.innerHTML !== nextHtml) {
        container.innerHTML = nextHtml;
      }
      return;
    }

    const tempContainer = document.createElement('div');
    tempContainer.innerHTML = nextHtml;

    morphdom(container, tempContainer, {
      childrenOnly: true,
      onBeforeElUpdated: (fromEl, toEl) => {
        if (fromEl.hasAttribute('data-expanded')) {
          toEl.setAttribute(
            'data-expanded',
            fromEl.getAttribute('data-expanded')!,
          );
        }
        return true;
      },
      onBeforeNodeDiscarded: (node) => {
        if (
          node instanceof HTMLElement &&
          node.classList.contains('transitioning')
        ) {
          return false;
        }
        return true;
      },
    });
  }, [content, streaming, isDark]);

  return <div ref={containerRef} className={proseClasses} />;
});

export default MorphdomMarkdown;
