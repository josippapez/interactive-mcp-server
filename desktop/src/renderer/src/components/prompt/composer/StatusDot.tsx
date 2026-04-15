type StatusDotProps = {
  type: string;
};

/** Status indicator dot with color based on type */
export function StatusDot({ type }: StatusDotProps): React.ReactElement {
  const colorMap: Record<string, string> = {
    info: 'bg-[var(--color-agent)]',
    working: 'bg-[var(--color-user)]',
    success: 'bg-[var(--color-success)]',
    error: 'bg-[var(--color-error)]',
  };
  const color = colorMap[type] ?? colorMap.info;
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full shrink-0 ${color} ${type === 'working' ? 'animate-pulse' : ''}`}
    />
  );
}
