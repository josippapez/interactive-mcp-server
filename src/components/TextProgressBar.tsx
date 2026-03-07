interface TextProgressBarProps {
  value: number;
  width?: number;
  timeLeftSeconds?: number;
  critical?: boolean;
}

export function TextProgressBar({
  value,
  width = 28,
  timeLeftSeconds,
  critical = false,
}: TextProgressBarProps) {
  const clamped = Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : 0;
  const filledWidth = Math.round((clamped / 100) * width);
  const bar = `${'█'.repeat(filledWidth)}${'░'.repeat(width - filledWidth)}`;
  const suffix =
    typeof timeLeftSeconds === 'number' ? ` • ${timeLeftSeconds}s left` : '';

  return (
    <text fg={critical ? 'red' : 'yellow'}>
      {`[${bar}] ${Math.round(clamped)}%${suffix}`}
    </text>
  );
}
