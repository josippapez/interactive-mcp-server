import * as OpenTuiReact from '@opentui/react';
import { useEffect, useState } from 'react';
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
const { useTimeline } = OpenTuiReact as unknown as {
  useTimeline: (options?: {
    duration?: number;
    loop?: boolean;
    autoplay?: boolean;
  }) => {
    add: (
      target: unknown,
      properties: {
        duration: number;
        ease: string;
        loop: boolean;
        alternate: boolean;
        [key: string]: unknown;
        onUpdate: (animation: { targets: Array<{ level: number }> }) => void;
      },
      startTime?: number | string,
    ) => unknown;
    play: () => unknown;
    pause: () => unknown;
    resetItems: () => void;
  };
};

export function PromptStatus({
  value,
  timeLeftSeconds,
  critical,
}: PromptStatusProps) {
  const { width } = useTerminalDimensions();
  const [pulseLevel, setPulseLevel] = useState(0);
  const timeline = useTimeline({ duration: 900, loop: true, autoplay: false });

  const suffixLength = ` • ${timeLeftSeconds}s left`.length;
  const availableWidth = Math.max(16, width - 4);
  const reservedWidth = 2 + 1 + 4 + suffixLength;
  const computedBarWidth = availableWidth - reservedWidth;
  const barWidth = Math.max(6, Math.min(28, computedBarWidth));
  const shortcutHint =
    width < 80 ? '⌃S send • ⇧↹ mode' : '⌃S send • ⇥ mode • ⇧↹ reverse';

  useEffect(() => {
    if (!critical) {
      timeline.pause();
      timeline.resetItems();
      setPulseLevel(0);
      return;
    }

    const pulseTarget = { level: 0 };
    timeline.resetItems();
    timeline.add(pulseTarget, {
      level: 1,
      duration: 900,
      ease: 'inOutSine',
      loop: true,
      alternate: true,
      onUpdate: (animation) => {
        const nextValue = animation.targets[0]?.level;
        if (typeof nextValue === 'number') {
          setPulseLevel(nextValue);
        }
      },
    });
    timeline.play();

    return () => {
      timeline.pause();
      timeline.resetItems();
    };
  }, [critical, timeline]);

  return (
    <box flexDirection="column" alignItems="flex-start" width="100%" gap={0}>
      <text fg="gray" wrapMode="word">
        {shortcutHint}
      </text>
      <text fg={critical && pulseLevel > 0.5 ? 'red' : 'gray'}>
        {critical ? '●' : '○'} {timeLeftSeconds}s remaining
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
