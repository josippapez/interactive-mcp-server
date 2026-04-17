/**
 * Mapping helpers for OpenCode message part types and tool statuses.
 */

export function mapPartType(
  type: string | undefined,
):
  | 'text'
  | 'reasoning'
  | 'tool-call'
  | 'tool-result'
  | 'image'
  | 'file'
  | 'step-start'
  | 'step-end'
  | 'compaction'
  | 'source-url'
  | 'unknown' {
  switch (type) {
    case 'text':
      return 'text';
    case 'reasoning':
      return 'reasoning';
    case 'tool':
      return 'tool-call';
    case 'tool-result':
      return 'tool-result';
    case 'image':
      return 'image';
    case 'file':
      return 'file';
    case 'step-start':
      return 'step-start';
    case 'step-end':
      return 'step-end';
    case 'compaction':
      return 'compaction';
    case 'source-url':
      return 'source-url';
    default:
      return 'unknown';
  }
}

export function mapToolStatus(
  status: string | undefined,
): 'pending' | 'running' | 'completed' | 'error' | undefined {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'running':
      return 'running';
    case 'completed':
      return 'completed';
    case 'error':
      return 'error';
    default:
      return undefined;
  }
}
