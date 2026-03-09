import * as OpenTuiReact from '@opentui/react';
import { TextProgressBar } from './TextProgressBar.js';

interface PromptStatusProps {
  value: number;
  timeLeftSeconds: number;
  critical: boolean;
}

interface TerminalDimensions {
  width: number;
  height: number;
}

const { useTerminalDimensions } = OpenTuiReact as unknown as {
  useTerminalDimensions: () => TerminalDimensions;
};

export function PromptStatus({
  value,
  timeLeftSeconds,
  critical,
}: PromptStatusProps) {
  const { width } = useTerminalDimensions();

  const suffixLength = ` • ${timeLeftSeconds}s left`.length;
  const availableWidth = Math.max(16, width - 4);
  const reservedWidth = 2 + 1 + 4 + suffixLength;
  const computedBarWidth = availableWidth - reservedWidth;
  const barWidth = Math.max(6, Math.min(28, computedBarWidth));
  const shortcutHint =
    width < 80 ? '⌃S send • ⇧↹ mode' : '⌃S send • ⇥ mode • ⇧↹ reverse';

  return (
    <box flexDirection="column" alignItems="flex-start" width="100%">
      <text fg="gray" wrapMode="word">
        {shortcutHint}
      </text>
      <TextProgressBar
        value={value}
        width={barWidth}
        timeLeftSeconds={timeLeftSeconds}
        critical={critical}
      />
    </box>
  );
}
