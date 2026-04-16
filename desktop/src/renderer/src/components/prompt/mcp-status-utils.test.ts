import { describe, expect, it } from 'vitest';
import {
  getMcpPrimaryAction,
  getMcpStatusIndicatorClass,
  getMcpStatusLabel,
  shouldShowRemoveAuth,
} from './mcp-status-utils';
import type { McpServer } from '../../hooks/useMcpServers';

function makeServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    name: 'test-server',
    type: 'remote',
    status: 'disconnected',
    ...overrides,
  };
}

describe('mcp-status-utils', () => {
  it('maps needs_auth to a readable label', () => {
    expect(getMcpStatusLabel('needs_auth')).toBe('Needs auth');
  });

  it('uses an auth-specific indicator color', () => {
    expect(getMcpStatusIndicatorClass('needs_auth')).toContain('bg-amber-500');
  });

  it('prefers authenticate for auth-blocked servers', () => {
    expect(getMcpPrimaryAction('needs_auth')).toEqual({
      action: 'authenticate',
      label: 'Authenticate',
    });
  });

  it('uses a dedicated action for client registration setup', () => {
    expect(getMcpPrimaryAction('needs_client_registration')).toEqual({
      action: 'configure_auth',
      label: 'Configure auth',
    });
    expect(getMcpStatusLabel('needs_client_registration')).toBe(
      'Needs client registration',
    );
    expect(getMcpStatusIndicatorClass('needs_client_registration')).toContain(
      'bg-orange-500',
    );
  });

  it('shows remove auth only for remote auth-related states', () => {
    expect(shouldShowRemoveAuth(makeServer({ status: 'needs_auth' }))).toBe(true);
    expect(
      shouldShowRemoveAuth(
        makeServer({ status: 'needs_client_registration' }),
      ),
    ).toBe(true);
    expect(shouldShowRemoveAuth(makeServer({ status: 'connected' }))).toBe(true);
    expect(shouldShowRemoveAuth(makeServer({ status: 'disconnected' }))).toBe(false);
    expect(
      shouldShowRemoveAuth(makeServer({ type: 'local', status: 'needs_auth' })),
    ).toBe(false);
  });
});
