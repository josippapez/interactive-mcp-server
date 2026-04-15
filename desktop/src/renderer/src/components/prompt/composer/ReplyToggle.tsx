type ReplyToggleProps = {
  noReply: boolean;
  onNoReplyChange: (noReply: boolean) => void;
  enabled: boolean;
};

/** Toggle switch for enabling/disabling agent reply */
export function ReplyToggle({
  noReply,
  onNoReplyChange,
  enabled,
}: ReplyToggleProps): React.ReactElement {
  return (
    <label
      className="flex items-center gap-1.5 cursor-pointer select-none px-1.5"
      title={
        noReply
          ? 'Reply OFF — message will be queued without triggering agent response'
          : 'Reply ON — message will trigger agent response'
      }
    >
      <span
        className={`text-[10px] font-medium transition-colors ${
          noReply
            ? 'text-[var(--color-text-muted)]'
            : 'text-[var(--color-text)]'
        }`}
      >
        Reply
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={!noReply}
        onClick={() => onNoReplyChange(!noReply)}
        disabled={!enabled}
        className={`relative w-7 h-4 rounded-full transition-colors disabled:opacity-40 ${
          noReply
            ? 'bg-[var(--color-surface-alt)] border border-[var(--color-border)]'
            : 'bg-[var(--color-success)]'
        }`}
      >
        <span
          className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${
            noReply
              ? 'left-0.5 bg-[var(--color-text-muted)]'
              : 'left-3.5 bg-white'
          }`}
        />
      </button>
    </label>
  );
}
