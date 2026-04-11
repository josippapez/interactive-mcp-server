import { memo } from 'react';
import { useRelativeTime } from '../../hooks/useRelativeTime';
import { formatFullTimestamp } from '../../lib/relative-time';

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
    <span title={fullTimestamp} className="cursor-default">
      {relativeTime}
    </span>
  );
});

export default MessageTimestamp;
