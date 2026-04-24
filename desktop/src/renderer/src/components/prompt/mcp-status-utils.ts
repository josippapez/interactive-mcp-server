import type { McpServer } from '../../hooks/useMcpServers';

export function getMcpStatusLabel(status: McpServer['status']): string {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'disconnected':
      return 'Disconnected';
    case 'connecting':
      return 'Connecting';
    case 'error':
      return 'Error';
    case 'needs_auth':
      return 'Needs auth';
    case 'needs_client_registration':
      return 'Needs client registration';
  }
}

export function getMcpStatusIndicatorClass(
  status: McpServer['status'],
): string {
  switch (status) {
    case 'connected':
      return 'bg-green-500';
    case 'disconnected':
      return 'bg-gray-400';
    case 'connecting':
      return 'bg-yellow-500 animate-pulse';
    case 'error':
      return 'bg-red-500';
    case 'needs_auth':
      return 'bg-amber-500';
    case 'needs_client_registration':
      return 'bg-orange-500';
  }
}

export function getMcpPrimaryAction(status: McpServer['status']): {
  action: 'connect' | 'disconnect' | 'authenticate' | 'configure_auth';
  label: string;
} {
  switch (status) {
    case 'connected':
      return { action: 'disconnect', label: 'Disconnect' };
    case 'needs_auth':
      return { action: 'authenticate', label: 'Authenticate' };
    case 'needs_client_registration':
      return { action: 'configure_auth', label: 'Configure auth' };
    case 'error':
      return { action: 'connect', label: 'Retry' };
    case 'connecting':
      return { action: 'connect', label: 'Connect' };
    case 'disconnected':
      return { action: 'connect', label: 'Connect' };
  }
}

export function shouldShowRemoveAuth(server: McpServer): boolean {
  return (
    server.type === 'remote' &&
    (server.status === 'connected' ||
      server.status === 'needs_auth' ||
      server.status === 'needs_client_registration')
  );
}
