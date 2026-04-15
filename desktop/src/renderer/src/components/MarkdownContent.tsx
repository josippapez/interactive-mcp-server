import { useTheme } from '../ThemeContext';
import MorphdomMarkdown from './MorphdomMarkdown';
import { getMarkdownProseClasses, renderMarkdown } from './markdown-renderer';

export default function MarkdownContent({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}): React.ReactElement {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  if (streaming) {
    return <MorphdomMarkdown content={content} streaming />;
  }

  return (
    <div className={getMarkdownProseClasses(isDark)}>
      {renderMarkdown(content, isDark)}
    </div>
  );
}
