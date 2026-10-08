/**
 * Shared prose utility classes for markdown content. Kept as a named export
 * so other components that render markdown-ish text (e.g. compaction
 * summaries) can pull the same classes without re-declaring them.
 */
export function getMarkdownProseClasses(
  isDark: boolean,
  className = '',
): string {
  return `prose max-w-none
    ${isDark ? 'prose-invert' : ''}
    prose-headings:text-[var(--color-text)]
    prose-p:text-[var(--color-text)] prose-p:my-1
    prose-a:text-[var(--color-agent)]
    prose-strong:text-[var(--color-text)]
    prose-code:text-[var(--color-agent)] prose-code:bg-[var(--color-surface)] prose-code:px-1 prose-code:py-0.5 prose-code:rounded-sm
    prose-pre:bg-transparent prose-pre:p-0 prose-pre:overflow-x-auto
    prose-li:text-[var(--color-text)] prose-li:marker:text-[var(--color-text-muted)]
    prose-th:text-[var(--color-text)] prose-td:text-[var(--color-text-muted)]
    prose-blockquote:border-[var(--color-tool)] prose-blockquote:text-[var(--color-text-muted)]
    ${className}`.trim();
}
