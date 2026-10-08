import type { SessionNode, SessionStatus } from '../../types';

export type BackgroundSubagentStatusLabel = 'Running' | 'Stalled' | 'Ended';

export type BackgroundSubagentDisplay = {
  id: string;
  title: string;
  status: 'running' | 'ended';
  depth: number;
  createdAt?: number;
  model: string | null;
  variant: string | null;
  isStalled: boolean;
  lastStatus?: string | null;
  lastStatusAt?: number;
  activityAt?: number;
  statusLabel?: BackgroundSubagentStatusLabel;
  statusSummary?: string;
};

const STALLED_AFTER_MS = 10 * 60_000;

export type BackgroundSubagentSummary = {
  total: number;
  running: number;
  stalled: number;
  ended: number;
};

export type BackgroundSubagentTabBadge = {
  count: number;
  label: string;
  tone: 'neutral' | 'active' | 'attention';
  title: string;
};

export function countRunningBackgroundSubagents(
  subagents: BackgroundSubagentDisplay[],
): number {
  return subagents.filter((subagent) => subagent.status === 'running').length;
}

export function isSubagentStalled(
  status: BackgroundSubagentDisplay['status'],
  createdAt: number | undefined,
  nowMs = Date.now(),
): boolean {
  return (
    status === 'running' &&
    typeof createdAt === 'number' &&
    nowMs - createdAt >= STALLED_AFTER_MS
  );
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveBackgroundSubagentTitle(node: SessionNode): string {
  const id = node.providerSessionId ?? node.id;
  return (
    readNonEmptyString(node.title) ??
    readNonEmptyString(node.activeSession?.title) ??
    readNonEmptyString(node.sessionChannel?.label) ??
    readNonEmptyString(node.prompt?.projectName) ??
    `Background Agent (${id})`
  );
}

function getStatusTimestamp(status: SessionStatus): number | undefined {
  const timestamp = status.timestamp.getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function compareStatusRecency(a: SessionStatus, b: SessionStatus): number {
  return (getStatusTimestamp(a) ?? 0) - (getStatusTimestamp(b) ?? 0);
}

function getLatestStatus(
  statuses: SessionStatus[],
  predicate: (status: SessionStatus) => boolean = () => true,
): SessionStatus | null {
  let latest: SessionStatus | null = null;
  for (const status of statuses) {
    if (!predicate(status)) continue;
    if (!latest || compareStatusRecency(status, latest) > 0) {
      latest = status;
    }
  }
  return latest;
}

function formatElapsed(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  if (totalMinutes < 1) return '<1m';
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatStatusSummary(input: {
  status: BackgroundSubagentDisplay['status'];
  isStalled: boolean;
  markerAt?: number;
  nowMs: number;
}): string {
  if (input.status === 'running') {
    const label = input.isStalled ? 'Stalled' : 'Running';
    if (typeof input.markerAt !== 'number') return label;
    return `${label} for ${formatElapsed(input.nowMs - input.markerAt)}`;
  }

  if (typeof input.markerAt !== 'number') return 'Ended';
  return `Ended ${formatElapsed(input.nowMs - input.markerAt)} ago`;
}

function getStatusLabel(
  status: BackgroundSubagentDisplay['status'],
  isStalled: boolean,
): BackgroundSubagentStatusLabel {
  if (isStalled) return 'Stalled';
  return status === 'running' ? 'Running' : 'Ended';
}

function getSortPriority(subagent: BackgroundSubagentDisplay): number {
  if (subagent.isStalled) return 0;
  if (subagent.status === 'running') return 1;
  return 2;
}

function compareText(a: string, b: string): number {
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  if (lowerA < lowerB) return -1;
  if (lowerA > lowerB) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareBackgroundSubagents(
  a: BackgroundSubagentDisplay,
  b: BackgroundSubagentDisplay,
): number {
  const priorityDiff = getSortPriority(a) - getSortPriority(b);
  if (priorityDiff !== 0) return priorityDiff;

  const titleDiff = compareText(a.title, b.title);
  if (titleDiff !== 0) return titleDiff;

  const activityDiff = (b.activityAt ?? 0) - (a.activityAt ?? 0);
  if (activityDiff !== 0) return activityDiff;

  return compareText(a.id, b.id);
}

export function deriveBackgroundSubagents(
  nodes: Map<string, SessionNode>,
  parentSessionId: string | null,
  nowMs = Date.now(),
): BackgroundSubagentDisplay[] {
  if (!parentSessionId) return [];
  return [...nodes.values()]
    .filter(
      (node) =>
        node.providerType === 'opencode' &&
        node.openCodeParentId === parentSessionId &&
        node.providerSessionId !== null,
    )
    .map((node) => {
      const latestStatus = getLatestStatus(node.sessionStatuses);
      const latestWorkingStatus = getLatestStatus(
        node.sessionStatuses,
        (entry) => entry.type === 'working',
      );
      const lastStatusAt = latestStatus
        ? getStatusTimestamp(latestStatus)
        : undefined;
      const runningMarkerAt = latestWorkingStatus
        ? getStatusTimestamp(latestWorkingStatus)
        : node.createdAt;
      const activityAt = lastStatusAt ?? node.createdAt;
      const status = node.sessionStatuses.some(
        (entry) => entry.type === 'working',
      )
        ? ('running' as const)
        : ('ended' as const);
      const isStalled = isSubagentStalled(status, runningMarkerAt, nowMs);
      return {
        id: node.providerSessionId as string,
        title: resolveBackgroundSubagentTitle(node),
        status,
        depth: node.depth,
        createdAt: node.createdAt,
        model: readNonEmptyString(node.prompt?.clientInfo?.model),
        variant: readNonEmptyString(node.prompt?.clientInfo?.mode),
        isStalled,
        lastStatus: latestStatus?.status ?? null,
        lastStatusAt,
        activityAt,
        statusLabel: getStatusLabel(status, isStalled),
        statusSummary: formatStatusSummary({
          status,
          isStalled,
          markerAt: status === 'running' ? runningMarkerAt : activityAt,
          nowMs,
        }),
      };
    })
    .sort(compareBackgroundSubagents);
}

export function summarizeBackgroundSubagents(
  subagents: BackgroundSubagentDisplay[],
): BackgroundSubagentSummary {
  const running = countRunningBackgroundSubagents(subagents);
  const stalled = subagents.filter((subagent) => subagent.isStalled).length;
  return {
    total: subagents.length,
    running,
    stalled,
    ended: subagents.length - running,
  };
}

function formatCount(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function getBackgroundSubagentTabCount(
  subagents: BackgroundSubagentDisplay[],
): number {
  return summarizeBackgroundSubagents(subagents).total;
}

export function getBackgroundSubagentTabBadge(
  subagents: BackgroundSubagentDisplay[],
): BackgroundSubagentTabBadge | null {
  const summary = summarizeBackgroundSubagents(subagents);
  if (summary.total === 0) return null;

  const details: string[] = [];
  if (summary.running > 0) {
    details.push(formatCount(summary.running, 'running', 'running'));
  }
  if (summary.stalled > 0) {
    details.push(formatCount(summary.stalled, 'stalled', 'stalled'));
  }
  if (details.length === 0 && summary.ended > 0) {
    details.push(formatCount(summary.ended, 'ended', 'ended'));
  }

  const titleParts = [
    formatCount(summary.total, 'background subagent'),
    ...details,
  ];

  return {
    count: summary.total,
    label: String(summary.total),
    tone:
      summary.stalled > 0
        ? 'attention'
        : summary.running > 0
          ? 'active'
          : 'neutral',
    title: titleParts.join(', '),
  };
}
