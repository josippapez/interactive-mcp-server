import { memo } from 'react';
import type { ProviderType } from '../../../types';
import type { SessionStatusType } from '../../../hooks/useSessionStatus';
import {
  STATUS_DOT_CLASSES,
  SESSION_STATUS_CLASSES,
  SESSION_STATUS_LABELS,
  PROVIDER_LABELS,
  PROVIDER_ICONS,
} from './types';

type StatusDotProps = {
  sessionStatuses: { status: string; type: string }[];
};

export const StatusDot = memo(function StatusDot({
  sessionStatuses,
}: StatusDotProps): React.ReactElement | null {
  const latest = sessionStatuses.at(-1);
  if (!latest) return null;

  const dotClass = STATUS_DOT_CLASSES[latest.type] ?? STATUS_DOT_CLASSES.info;
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`}
      title={latest.status}
    />
  );
});

type SessionStatusBadgeProps = {
  status: SessionStatusType | null;
};

/** Live session status indicator from OpenCode API */
export const SessionStatusBadge = memo(function SessionStatusBadge({
  status,
}: SessionStatusBadgeProps): React.ReactElement | null {
  if (!status || status === 'idle') return null;

  const dotClass = SESSION_STATUS_CLASSES[status];
  const label = SESSION_STATUS_LABELS[status];

  return (
    <span
      className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`}
      title={label}
    />
  );
});

type ProviderBadgeProps = {
  providerType: ProviderType | null;
};

export const ProviderBadge = memo(function ProviderBadge({
  providerType,
}: ProviderBadgeProps): React.ReactElement | null {
  if (!providerType) return null;

  const colors: Record<ProviderType, string> = {
    opencode: 'text-emerald-400',
    'copilot-cli': 'text-blue-400',
    'claude-sdk': 'text-orange-400',
    standalone: 'text-gray-400',
  };

  return (
    <span
      className={`text-[9px] shrink-0 ${colors[providerType]}`}
      title={PROVIDER_LABELS[providerType]}
    >
      {PROVIDER_ICONS[providerType]}
    </span>
  );
});
