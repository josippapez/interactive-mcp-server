import type { Attachment } from '../../types';
import type { UnifiedMessage } from '../../types/unified-message';

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
      return 'Failed';
    }
    if (msg.channelKind === 'agent_message') return 'Agent';
    return 'Agent';
  }

  if (msg.role === 'user') return 'You';
  if (msg.role === 'system') return 'System';
  return formatAgentName(msg.agent);
}

export function unifiedMessageClass(msg: UnifiedMessage): string {
  if (msg.source === 'channel') {
    if (msg.channelKind === 'answer' || msg.channelKind === 'outbound') {
      return 'msg-user';
    }
    if (msg.channelKind === 'agent_message') return 'msg-agent-info';
    return 'msg-agent';
  }

  if (msg.role === 'user') return 'msg-user';
  if (msg.role === 'system') return 'msg-system';
  return 'msg-conversation';
}

export function isImageAttachment(att: Attachment): boolean {
  return att.mimeType.startsWith('image/') && att.data.length > 0;
}

export function formatTokens(tokens?: UnifiedMessage['tokens']): string | null {
  if (!tokens) return null;
  const total =
    tokens.total ??
    (tokens.input ?? 0) +
      (tokens.output ?? 0) +
      (tokens.reasoning ?? 0) +
      (tokens.cache?.read ?? 0) +
      (tokens.cache?.write ?? 0);
  if (total > 0) return `${total.toLocaleString()} tokens`;
  return null;
}

export function formatCost(cost?: number): string | null {
  if (cost == null || cost === 0) return null;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

const EFFORT_LEVELS = {
  low: { label: 'Low effort', variant: 'effort-low' },
  medium: { label: 'Medium effort', variant: 'effort-medium' },
  high: { label: 'High effort', variant: 'effort-high' },
  xhigh: { label: 'Max effort', variant: 'effort-xhigh' },
} as const;

export function getEffortBadge(variantStr?: string) {
  if (!variantStr) return null;
  return (
    EFFORT_LEVELS[variantStr.toLowerCase() as keyof typeof EFFORT_LEVELS] ??
    null
  );
}
