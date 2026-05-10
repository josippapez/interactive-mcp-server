import type { Attachment } from '../../types';
import type { UnifiedMessage } from '../../types/unified-message';

export function getAttachmentKey(
  messageId: string,
  attachment: Attachment,
  index: number,
): string {
  return `${messageId}-att-${index}-${attachment.name}-${attachment.mimeType}`;
}

export function formatAgentName(agent: string | undefined): string {
  if (!agent) return 'Assistant';
  const lowerAgent = agent.toLowerCase();
  if (lowerAgent === 'main') return 'Main Agent';
  return agent
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function isSubagent(agent: string | undefined): boolean {
  if (!agent) return false;
  return agent.toLowerCase() !== 'main';
}

export function unifiedRoleLabel(msg: UnifiedMessage): string {
  if (msg.source === 'channel') {
    if (msg.channelKind === 'answer') return 'You';
    if (msg.channelKind === 'outbound') {
      if (msg.role === 'sent') return 'Sent';
      if (msg.role === 'sending') return 'Sending';
      return 'Queued';
    }
    if (msg.channelKind === 'agent_message') return 'Agent';
    return 'Agent';
  }

  if (msg.role === 'user') return 'You';
  if (msg.role === 'system') return 'System';
  return formatAgentName(msg.agent);
}

export function isImageAttachment(att: Attachment): boolean {
  return att.mimeType.startsWith('image/') && att.data.length > 0;
}

export function formatCost(cost?: number): string | null {
  if (cost == null || cost === 0) return null;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export function formatDurationMs(durationMs?: number): string | null {
  if (durationMs == null || durationMs <= 0) return null;
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

export function formatModeName(mode?: string): string | null {
  if (!mode) return null;
  return mode
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function getExecutionStatusLabel({
  completedAt,
  isStreaming,
  now,
  source,
  timestamp,
  userSide,
}: {
  completedAt?: number;
  isStreaming: boolean;
  now: number;
  source: UnifiedMessage['source'];
  timestamp: number;
  userSide: boolean;
}): string | null {
  const completedDuration = formatDurationMs(
    completedAt ? completedAt - timestamp : undefined,
  );
  if (completedDuration) return completedDuration;

  if (userSide || source !== 'conversation' || !isStreaming) return null;

  const elapsed = formatDurationMs(Math.max(0, now - timestamp)) ?? '0ms';
  return `executing ${elapsed}`;
}

const EFFORT_LEVELS = {
  none: { label: 'No reasoning', variant: 'effort-none' },
  minimal: { label: 'Minimal effort', variant: 'effort-minimal' },
  low: { label: 'Low effort', variant: 'effort-low' },
  medium: { label: 'Medium effort', variant: 'effort-medium' },
  high: { label: 'High effort', variant: 'effort-high' },
  xhigh: { label: 'Max effort', variant: 'effort-xhigh' },
  max: { label: 'Max effort', variant: 'effort-max' },
} as const;

export function getEffortBadge(variantStr?: string) {
  if (!variantStr) return null;
  return (
    EFFORT_LEVELS[variantStr.toLowerCase() as keyof typeof EFFORT_LEVELS] ??
    null
  );
}

export function getAssistantHeaderMetadata({
  agent,
  modelId,
  roleLabel,
  variant,
}: {
  agent?: string;
  modelId?: string;
  roleLabel: string;
  variant?: string;
}) {
  return {
    agentBadgeLabel: isSubagent(agent) ? roleLabel : null,
    effortBadge: getEffortBadge(variant),
    modelLabel: modelId ?? null,
  };
}

const SYSTEM_BLOCK_REGEX =
  /<(system-reminder|system_notification)>[\s\S]*?<\/\1>/gi;

const DOC_SECTION_REGEXES = [
  /(?:^|\n)Repository documentation index for [^\n]*:[\s\S]*?(?=\n\n[A-Z<[]|\n\nUse the Read tool|\n\nUse the find_repo_docs tool|$)/gi,
  /(?:^|\n)Relevant repository documentation[^\n]*:[\s\S]*?(?=\n\n[A-Z<[]|\n\nUse the Read tool|\n\nUse the find_repo_docs tool|$)/gi,
  /(?:^|\n)Top doc matches for "[^"]*":[\s\S]*?(?=\n\n[A-Z<[]|\n\nUse the Read tool|\n\nUse the find_repo_docs tool|$)/gi,
  /(?:^|\n)\*\*Context injected \(\d+ docs?\):\*\*[\s\S]*?(?=\n\n[A-Z<[]|$)/gi,
  /(?:^|\n)Context injected \(\d+ docs?\):[\s\S]*?(?=\n\n[A-Z<[]|$)/gi,
];

/**
 * Filter message text based on display settings.
 *
 * Hot path: this runs on every streamed token batch for every visible
 * assistant message, so we fast-path the (extremely common) cases where
 * no filtering is needed:
 *   - no flags enabled
 *   - empty/whitespace-only text
 *   - text too short to possibly contain any of the filtered patterns
 *
 * Only fall through to the (N × regex) scan when at least one flag is
 * on AND the text is long enough for a match to be possible. The
 * shortest filterable marker is `<system-reminder></system-reminder>`
 * (~35 chars) so we use 32 as a conservative lower bound.
 *
 * @param text - The original message text
 * @param hideSystemReminders - Whether to hide <system-reminder> tags
 * @param hideDocInjections - Whether to hide doc injection content
 * @returns Filtered text with specified content removed
 */
export function filterMessageText(
  text: string,
  hideSystemReminders: boolean,
  hideDocInjections: boolean,
): string {
  if (!text) return '';
  if (!hideSystemReminders && !hideDocInjections) return text;
  if (text.length < 32) return text;

  // Cheap content probe before running the expensive regex sweep:
  // if neither marker substring is present we can return the text as-is.
  const maybeSystem = hideSystemReminders && text.includes('<system');
  const maybeDoc =
    hideDocInjections &&
    (text.includes('Repository documentation') ||
      text.includes('Relevant repository documentation') ||
      text.includes('Top doc matches') ||
      text.includes('Context injected'));
  if (!maybeSystem && !maybeDoc) return text;

  let filtered = text;

  if (maybeSystem) {
    filtered = filtered.replace(SYSTEM_BLOCK_REGEX, '');
  }

  if (maybeDoc) {
    for (const regex of DOC_SECTION_REGEXES) {
      filtered = filtered.replace(regex, '');
    }
  }

  // Clean up extra whitespace from removals
  return filtered.replace(/\n{3,}/g, '\n\n').trim();
}
