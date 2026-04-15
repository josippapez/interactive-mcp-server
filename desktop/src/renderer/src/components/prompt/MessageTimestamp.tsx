import { memo } from 'react';
import { useRelativeTime } from '../../hooks/useRelativeTime';
import { formatFullTimestamp } from '../../lib/relative-time';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type Props = {
  timestamp: Date;
};

/**
 * Displays a relative timestamp (e.g., "2m ago") that updates every minute.
 * Shows the full timestamp on hover via a native tooltip.
 */
const MessageTimestamp = memo(function MessageTimestamp({
  timestamp,
}: Props): React.ReactElement {
  const relativeTime = useRelativeTime(timestamp);
  const fullTimestamp = formatFullTimestamp(timestamp);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time dateTime={timestamp.toISOString()} className="cursor-default">
          {relativeTime}
        </time>
      </TooltipTrigger>
      <TooltipContent>{fullTimestamp}</TooltipContent>
    </Tooltip>
  );
});

export default MessageTimestamp;
