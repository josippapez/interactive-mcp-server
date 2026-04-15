import React, { memo } from 'react';

/**
 * Unread divider component that appears between read and unread messages.
 */
const UnreadDivider = memo(function UnreadDivider(): React.ReactElement {
  return (
    <div className="flex items-center gap-2 py-2 my-1">
      <div className="flex-1 h-px bg-[var(--color-error)]/40" />
      <span className="text-[10px] uppercase tracking-wide text-[var(--color-error)] font-medium px-2">
        New messages
      </span>
      <div className="flex-1 h-px bg-[var(--color-error)]/40" />
    </div>
  );
});

export default UnreadDivider;
