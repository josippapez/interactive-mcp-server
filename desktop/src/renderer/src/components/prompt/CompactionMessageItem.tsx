import MarkdownContent from '../MarkdownContent';
import MessageTimestamp from './MessageTimestamp';
import type { UnifiedMessage } from '../../types/unified-message';

export default function CompactionMessageItem({
  msg,
}: {
  msg: UnifiedMessage;
}): React.ReactElement {
  return (
    <div className="my-3 mx-1 rounded-lg border-2 border-amber-500/50 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-amber-500/10 shadow-lg shadow-amber-500/10">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-500/30 bg-amber-500/5">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="w-5 h-5 text-amber-800 dark:text-amber-500"
        >
          <path
            fillRule="evenodd"
            d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z"
            clipRule="evenodd"
          />
        </svg>
        <span className="text-sm font-semibold text-amber-950 dark:text-amber-400 uppercase tracking-wide">
          Context Compaction
        </span>
        <span className="text-[10px] text-amber-950/70 dark:text-amber-400/70">
          Previous context summarized to save tokens
        </span>
        <MessageTimestamp timestamp={new Date(msg.timestamp)} />
      </div>
      <div className="px-3 py-2 text-sm">
        {msg.text && <MarkdownContent content={msg.text} streaming={false} />}
      </div>
    </div>
  );
}
