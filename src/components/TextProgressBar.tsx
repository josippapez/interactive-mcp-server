import type { ThemeColors } from '@/theme.js';

interface TextProgressBarProps {
  value: number;
  width?: number;
  timeLeftSeconds?: number;
  critical?: boolean;
  theme: ThemeColors;
}

export function TextProgressBar({
  value,
  width = 28,
  timeLeftSeconds,
  critical = false,
  theme,
}: TextProgressBarProps) {
  const clamped = Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : 0;
  const filledWidth = Math.round((clamped / 100) * width);
  const bar = `${'█'.repeat(filledWidth)}${'░'.repeat(width - filledWidth)}`;
  const suffix =
    typeof timeLeftSeconds === 'number' ? ` • ${timeLeftSeconds}s left` : '';

  return (
    <text fg={critical ? theme.progressCritical : theme.progressNormal}>
      {`[${bar}] ${Math.round(clamped)}%${suffix}`}
    </text>
  );
}
