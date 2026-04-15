import type { Attachment } from '../types';
import type { UnifiedMessage } from '../types/unified-message';

/**
 * Get role label for unified messages.
 */
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
  if (msg.agent) return msg.agent.charAt(0).toUpperCase() + msg.agent.slice(1);
  return 'Assistant';
}

/**
 * Get CSS class for unified message styling.
 */
export function unifiedMessageClass(msg: UnifiedMessage): string {
  if (msg.source === 'channel') {
    if (msg.channelKind === 'answer' || msg.channelKind === 'outbound')
      return 'msg-user';
    if (msg.channelKind === 'agent_message') return 'msg-agent-info';
    return 'msg-agent';
  }
  if (msg.role === 'user') return 'msg-user';
  if (msg.role === 'system') return 'msg-system';
  return 'msg-conversation';
}

/**
 * Check if an attachment is a displayable image.
 */
export function isImageAttachment(att: Attachment): boolean {
  return att.mimeType.startsWith('image/') && att.data.length > 0;
}

/**
 * Format token count for display.
 */
export function formatTokens(tokens?: UnifiedMessage['tokens']): string | null {
  if (!tokens) return null;
  if (tokens.total) return `${tokens.total.toLocaleString()} tokens`;
  if (tokens.input || tokens.output) {
    const parts: string[] = [];
    if (tokens.input) parts.push(`${tokens.input.toLocaleString()} in`);
    if (tokens.output) parts.push(`${tokens.output.toLocaleString()} out`);
    return parts.join(' / ');
  }
  return null;
}

/**
 * Format cost for display.
 */
export function formatCost(cost?: number): string | null {
  if (cost == null || cost === 0) return null;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}
