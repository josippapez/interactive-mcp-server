import React, { memo } from 'react';
import { Badge } from '@/components/ui/badge';

export const ToolStatusBadge = memo(function ToolStatusBadge({
  status,
}: {
  status?: 'pending' | 'running' | 'completed' | 'error';
}): React.ReactElement {
  const statusVariants = {
    pending: 'status-pending',
    running: 'status-running',
    completed: 'status-completed',
    error: 'status-error',
  } as const;

  const statusLabels = {
    pending: 'Pending',
    running: 'Running',
    completed: 'Done',
    error: 'Error',
  };

  const variant = status ? statusVariants[status] : statusVariants.pending;
  const label = status ? statusLabels[status] : 'Unknown';

  return (
    <Badge variant={variant} size="xs">
      {status === 'running' && (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse mr-1" />
      )}
      {label}
    </Badge>
  );
});

export function getToolInputSummary(
  toolName: string,
  input: Record<string, unknown> | undefined,
): string | null {
  if (!input) return null;

  const pathFields = [
    'filePath',
    'path',
    'file',
    'directory',
    'dir',
    'workdir',
  ];
  const commandFields = ['command', 'cmd', 'script'];
  const queryFields = ['query', 'pattern', 'search', 'name'];
  const urlFields = ['url', 'uri', 'endpoint'];

  for (const field of pathFields) {
    if (typeof input[field] === 'string' && input[field]) {
      return input[field] as string;
    }
  }

  for (const field of commandFields) {
    if (typeof input[field] === 'string' && input[field]) {
      const cmd = input[field] as string;
      return cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
    }
  }

  for (const field of queryFields) {
    if (typeof input[field] === 'string' && input[field]) {
      const query = input[field] as string;
      return query.length > 50 ? query.slice(0, 47) + '...' : query;
    }
  }

  for (const field of urlFields) {
    if (typeof input[field] === 'string' && input[field]) {
      return input[field] as string;
    }
  }

  if (
    toolName.toLowerCase().includes('todo') &&
    Array.isArray(input['todos'])
  ) {
    return `${input['todos'].length} items`;
  }

  return null;
}

export function formatInputCompact(input: Record<string, unknown>): string {
  const entries = Object.entries(input);
  if (entries.length === 0) return '';

  return entries
    .map(([key, value]) => {
      let displayValue: string;
      if (typeof value === 'string') {
        displayValue = value.length > 100 ? value.slice(0, 97) + '...' : value;
      } else if (Array.isArray(value)) {
        displayValue = `[${value.length} items]`;
      } else if (typeof value === 'object' && value !== null) {
        displayValue = '{...}';
      } else {
        displayValue = String(value);
      }
      return `${key}: ${displayValue}`;
    })
    .join('\n');
}
