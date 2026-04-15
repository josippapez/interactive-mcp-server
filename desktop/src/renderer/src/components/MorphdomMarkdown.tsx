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
