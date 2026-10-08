type MessageDirection = 'to_parent' | 'to_subagent';

export function buildBackgroundSubagentMessage(input: {
  direction: MessageDirection;
  fromSessionId: string;
  toSessionId: string;
  message: string;
  reason?: string;
}): string {
  const lines = [
    '<background-subagent-message>',
    `- Direction: ${input.direction}`,
    `- From session: ${input.fromSessionId}`,
    `- To session: ${input.toSessionId}`,
  ];
  const reason = input.reason?.trim();
  if (reason) lines.push(`- Reason: ${reason}`);
  lines.push('', '<message>', input.message.trim(), '</message>');
  lines.push('</background-subagent-message>');
  return lines.join('\n');
}
