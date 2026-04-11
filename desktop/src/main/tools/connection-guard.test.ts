import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

vi.mock('../database', () => ({
  getRegisteredConnection: vi.fn(),
}));

import { getRegisteredConnection } from '../database';
import {
  missingSessionIdError,
  missingSessionIdParamError,
  markConnectionDeleted,
  staleConnectionError,
} from './connection-guard';

describe('connection-guard', () => {
  const mockGetRegisteredConnection = getRegisteredConnection as Mock;

  beforeEach(() => {
    mockGetRegisteredConnection.mockReset();
  });

  describe('staleConnectionError', () => {
    it('returns null when connection has not been deleted', () => {
      const result = staleConnectionError('conn-active');
      expect(result).toBeNull();
    });

    it('returns SESSION_REMOVED error when connection was deleted', () => {
      markConnectionDeleted('conn-deleted-guard-test');
      const result = staleConnectionError('conn-deleted-guard-test');
      expect(result).not.toBeNull();
      expect(result?.isError).toBe(true);
      const payload = JSON.parse(
        result!.content[0].type === 'text' ? result!.content[0].text : '',
      ) as { error: string };
      expect(payload.error).toBe('SESSION_REMOVED');
    });
  });

  describe('missingSessionIdError', () => {
    it('returns null when requireSessionId is false (standalone mode)', () => {
      // Even if the connection has no openCodeSessionId, standalone mode is fine
      mockGetRegisteredConnection.mockReturnValue({
        connectionId: 'conn-standalone',
        channelName: 'Standalone',
        projectName: 'proj',
        openCodeSessionId: null,
      });

      const result = missingSessionIdError('conn-standalone', false);
      expect(result).toBeNull();
    });

    it('returns null when requireSessionId is false even without any connection record', () => {
      mockGetRegisteredConnection.mockReturnValue(null);

      const result = missingSessionIdError('conn-missing', false);
      expect(result).toBeNull();
    });

    it('returns null when requireSessionId is true and openCodeSessionId is present', () => {
      mockGetRegisteredConnection.mockReturnValue({
        connectionId: 'conn-oc',
        channelName: 'Agent',
        projectName: 'proj',
        openCodeSessionId: 'ses_abc123',
      });

      const result = missingSessionIdError('conn-oc', true);
      expect(result).toBeNull();
    });

    it('returns MISSING_SESSION_ID error when requireSessionId is true and openCodeSessionId is null', () => {
      mockGetRegisteredConnection.mockReturnValue({
        connectionId: 'conn-no-session',
        channelName: 'Agent',
        projectName: 'proj',
        openCodeSessionId: null,
      });

      const result = missingSessionIdError('conn-no-session', true);
      expect(result).not.toBeNull();
      expect(result?.isError).toBe(true);

      const payload = JSON.parse(
        result!.content[0].type === 'text' ? result!.content[0].text : '',
      ) as {
        error: string;
        message: string;
        action: string;
        connectionId: string;
      };

      expect(payload.error).toBe('MISSING_SESSION_ID');
      expect(payload.connectionId).toBe('conn-no-session');
      expect(payload.action).toMatch(/register_connection/);
      expect(payload.action).toMatch(/openCodeSessionId/);
    });

    it('returns MISSING_SESSION_ID error when requireSessionId is true and openCodeSessionId is undefined (no connection record)', () => {
      mockGetRegisteredConnection.mockReturnValue(null);

      const result = missingSessionIdError('conn-unregistered', true);
      expect(result).not.toBeNull();
      expect(result?.isError).toBe(true);

      const payload = JSON.parse(
        result!.content[0].type === 'text' ? result!.content[0].text : '',
      ) as { error: string; connectionId: string };

      expect(payload.error).toBe('MISSING_SESSION_ID');
      expect(payload.connectionId).toBe('conn-unregistered');
    });

    it('returns MISSING_SESSION_ID error when requireSessionId is true and connection has empty string session ID', () => {
      mockGetRegisteredConnection.mockReturnValue({
        connectionId: 'conn-empty',
        channelName: 'Agent',
        projectName: 'proj',
        openCodeSessionId: '',
      });

      const result = missingSessionIdError('conn-empty', true);
      expect(result).not.toBeNull();
      expect(result?.isError).toBe(true);

      const payload = JSON.parse(
        result!.content[0].type === 'text' ? result!.content[0].text : '',
      ) as { error: string };

      expect(payload.error).toBe('MISSING_SESSION_ID');
    });
  });

  describe('missingSessionIdParamError', () => {
    it('returns null when requireSessionId is false (standalone mode)', () => {
      const result = missingSessionIdParamError(undefined, false);
      expect(result).toBeNull();
    });

    it('returns null when requireSessionId is false even with empty string', () => {
      const result = missingSessionIdParamError('', false);
      expect(result).toBeNull();
    });

    it('returns null when requireSessionId is true and openCodeSessionId is provided', () => {
      const result = missingSessionIdParamError('ses_abc123', true);
      expect(result).toBeNull();
    });

    it('returns MISSING_SESSION_ID_PARAM error when requireSessionId is true and openCodeSessionId is undefined', () => {
      const result = missingSessionIdParamError(undefined, true);
      expect(result).not.toBeNull();
      expect(result?.isError).toBe(true);

      const payload = JSON.parse(
        result!.content[0].type === 'text' ? result!.content[0].text : '',
      ) as { error: string; message: string; action: string; hint: string };

      expect(payload.error).toBe('MISSING_SESSION_ID_PARAM');
      expect(payload.message).toMatch(/MUST pass.*openCodeSessionId/);
      expect(payload.action).toMatch(/ses_<alphanumeric>/);
      expect(payload.hint).toMatch(/system-reminder/);
    });

    it('returns MISSING_SESSION_ID_PARAM error when requireSessionId is true and openCodeSessionId is null', () => {
      const result = missingSessionIdParamError(null, true);
      expect(result).not.toBeNull();
      expect(result?.isError).toBe(true);

      const payload = JSON.parse(
        result!.content[0].type === 'text' ? result!.content[0].text : '',
      ) as { error: string };

      expect(payload.error).toBe('MISSING_SESSION_ID_PARAM');
    });

    it('returns MISSING_SESSION_ID_PARAM error when requireSessionId is true and openCodeSessionId is empty string', () => {
      const result = missingSessionIdParamError('', true);
      expect(result).not.toBeNull();
      expect(result?.isError).toBe(true);

      const payload = JSON.parse(
        result!.content[0].type === 'text' ? result!.content[0].text : '',
      ) as { error: string };

      expect(payload.error).toBe('MISSING_SESSION_ID_PARAM');
    });

    it('returns MISSING_SESSION_ID_PARAM error when requireSessionId is true and openCodeSessionId is whitespace only', () => {
      const result = missingSessionIdParamError('   ', true);
      expect(result).not.toBeNull();
      expect(result?.isError).toBe(true);

      const payload = JSON.parse(
        result!.content[0].type === 'text' ? result!.content[0].text : '',
      ) as { error: string };

      expect(payload.error).toBe('MISSING_SESSION_ID_PARAM');
    });
  });
});
