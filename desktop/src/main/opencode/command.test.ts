/**
 * Tests for command.ts — OpenCode slash command API integration.
 *
 * Following TDD: write tests first, then implement.
 *
 * OpenCode API:
 * - GET /command — List available commands
 * - POST /session/:id/command — Execute a command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  fetchCommands,
  executeCommand,
  getCachedCommands,
  clearCommandCache,
  type CommandsResponse,
} from './command';

describe('command', () => {
  beforeEach(() => {
    clearCommandCache();
    vi.clearAllMocks();
    vi.spyOn(global, 'fetch').mockRejectedValue(
      new Error('Unexpected unmocked fetch call'),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchCommands', () => {
    it('returns commands from the OpenCode API', async () => {
      const mockCommands: CommandsResponse = {
        commands: [
          {
            name: 'compact',
            description: 'Compact the conversation context',
            args: [],
          },
          {
            name: 'clear',
            description: 'Clear the conversation history',
            args: [],
          },
          {
            name: 'model',
            description: 'Switch to a different model',
            args: [
              { name: 'model_id', description: 'Model ID', required: true },
            ],
          },
        ],
      };

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockCommands,
      } as Response);

      const result = await fetchCommands(3000);

      expect(result).toEqual(mockCommands.commands);
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/command',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('returns null when API returns non-OK status', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      const result = await fetchCommands(3000);

      expect(result).toBeNull();
    });

    it('returns null when fetch throws', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValueOnce(
        new Error('Network error'),
      );

      const result = await fetchCommands(3000);

      expect(result).toBeNull();
    });

    it('caches commands after successful fetch', async () => {
      const mockCommands: CommandsResponse = {
        commands: [
          {
            name: 'compact',
            description: 'Compact the conversation context',
            args: [],
          },
        ],
      };

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockCommands,
      } as Response);

      await fetchCommands(3000);
      const cached = getCachedCommands();

      expect(cached).toEqual(mockCommands.commands);
    });
  });

  describe('executeCommand', () => {
    it('executes a command successfully', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      const result = await executeCommand(3000, 'ses_123', 'compact');

      expect(result).toEqual({ ok: true });
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/session/ses_123/command',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'compact' }),
        }),
      );
    });

    it('executes a command with arguments', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      const result = await executeCommand(3000, 'ses_123', 'model', {
        model_id: 'claude-opus-4-20250514',
      });

      expect(result).toEqual({ ok: true });
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/session/ses_123/command',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            name: 'model',
            args: { model_id: 'claude-opus-4-20250514' },
          }),
        }),
      );
    });

    it('returns error when API returns non-OK status', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Invalid command',
      } as Response);

      const result = await executeCommand(3000, 'ses_123', 'invalid');

      expect(result.ok).toBe(false);
      expect(result.error).toContain('all reachable OpenCode endpoints');
    });

    it('returns error when fetch throws', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValueOnce(
        new Error('Network error'),
      );

      const result = await executeCommand(3000, 'ses_123', 'compact');

      expect(result.ok).toBe(false);
      expect(result.error).toContain('all reachable OpenCode endpoints');
    });
  });

  describe('clearCommandCache', () => {
    it('clears the cached commands', async () => {
      const mockCommands: CommandsResponse = {
        commands: [
          {
            name: 'compact',
            description: 'Compact the conversation context',
            args: [],
          },
        ],
      };

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockCommands,
      } as Response);

      await fetchCommands(3000);
      expect(getCachedCommands()).not.toBeNull();

      clearCommandCache();
      expect(getCachedCommands()).toBeNull();
    });
  });
});
