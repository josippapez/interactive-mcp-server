import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
  oneDark,
  oneLight,
} from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTheme } from '../ThemeContext';

export default function MarkdownContent({
  content,
}: {
  content: string;
}): React.ReactElement {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <div
      className={`prose prose-sm max-w-none
        ${isDark ? 'prose-invert' : ''}
        prose-headings:text-[var(--color-text)]
        prose-p:text-[var(--color-text)]
        prose-a:text-[var(--color-agent)]
        prose-strong:text-[var(--color-text)]
        prose-code:text-[var(--color-agent)] prose-code:bg-[var(--color-surface)] prose-code:px-1 prose-code:py-0.5 prose-code:rounded-sm
        prose-pre:bg-transparent prose-pre:p-0
        prose-li:text-[var(--color-text)]
        prose-th:text-[var(--color-text)] prose-td:text-[var(--color-text-muted)]
        prose-blockquote:border-[var(--color-tool)] prose-blockquote:text-[var(--color-text-muted)]`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const codeString = String(children).replace(/\n$/, '');
            if (match) {
              return (
                <SyntaxHighlighter
                  style={isDark ? oneDark : oneLight}
                  language={match[1]}
                  PreTag="div"
                  customStyle={{
                    margin: 0,
                    borderRadius: '0.25rem',
                    fontSize: '0.8rem',
                    background: isDark ? '#111111' : '#f8fafc',
                  }}
                >
                  {codeString}
                </SyntaxHighlighter>
              );
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
