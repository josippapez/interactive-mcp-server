import { describe, it, expect } from 'vitest';

import {
  requireProviderSessionId,
  markSessionDeleted,
  staleSessionError,
} from './connection-guard';

describe('connection-guard', () => {
  describe('staleSessionError', () => {
    it('returns null when session has not been deleted', () => {
      const result = staleSessionError('ses_active');
      expect(result).toBeNull();
    });

    it('returns SESSION_REMOVED error when session was deleted', () => {
      markSessionDeleted('ses_deleted-guard-test');
      const result = staleSessionError('ses_deleted-guard-test');
      expect(result).not.toBeNull();
      expect(result?.isError).toBe(true);
      const payload = JSON.parse(
        result!.content[0].type === 'text' ? result!.content[0].text : '',
      ) as { error: string };
      expect(payload.error).toBe('SESSION_REMOVED');
    });
  });

  describe('requireProviderSessionId', () => {
    it('returns null when requireSessionId is false (standalone mode)', () => {
      const result = requireProviderSessionId(undefined, false);
      expect(result).toBeNull();
    });

    it('returns null when requireSessionId is false even with empty string', () => {
      const result = requireProviderSessionId('', false);
      expect(result).toBeNull();
    });

    it('returns null when requireSessionId is true and providerSessionId is provided', () => {
      const result = requireProviderSessionId('ses_abc123', true);
      expect(result).toBeNull();
    });

    it('returns MISSING_SESSION_ID error when requireSessionId is true and providerSessionId is undefined', () => {
      const result = requireProviderSessionId(undefined, true);
      expect(result).not.toBeNull();
      expect(result?.isError).toBe(true);

      const payload = JSON.parse(
        result!.content[0].type === 'text' ? result!.content[0].text : '',
      ) as { error: string; message: string; action: string; hint: string };

      expect(payload.error).toBe('MISSING_SESSION_ID');
      expect(payload.message).toMatch(/MUST pass.*openCodeSessionId/);
      expect(payload.action).toMatch(/ses_<alphanumeric>/);
      expect(payload.hint).toMatch(/system-reminder/);
    });

    it('returns MISSING_SESSION_ID error when requireSessionId is true and providerSessionId is null', () => {
      const result = requireProviderSessionId(null, true);
      expect(result).not.toBeNull();
      expect(result?.isError).toBe(true);

      const payload = JSON.parse(
        result!.content[0].type === 'text' ? result!.content[0].text : '',
      ) as { error: string };

      expect(payload.error).toBe('MISSING_SESSION_ID');
    });

    it('returns MISSING_SESSION_ID error when requireSessionId is true and providerSessionId is empty string', () => {
      const result = requireProviderSessionId('', true);
      expect(result).not.toBeNull();
      expect(result?.isError).toBe(true);

      const payload = JSON.parse(
        result!.content[0].type === 'text' ? result!.content[0].text : '',
      ) as { error: string };

      expect(payload.error).toBe('MISSING_SESSION_ID');
    });

    it('returns MISSING_SESSION_ID error when requireSessionId is true and providerSessionId is whitespace only', () => {
      const result = requireProviderSessionId('   ', true);
      expect(result).not.toBeNull();
      expect(result?.isError).toBe(true);

      const payload = JSON.parse(
        result!.content[0].type === 'text' ? result!.content[0].text : '',
      ) as { error: string };

      expect(payload.error).toBe('MISSING_SESSION_ID');
    });
  });
});
