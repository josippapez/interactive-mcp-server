/**
 * Tests for command.ts — OpenCode slash command API integration.
 *
 * Uses SDK mock pattern via _setClientFactory.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _setClientFactory, _resetClientFactory } from './sdk-client';

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
  });

  afterEach(() => {
    _resetClientFactory();
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

      _setClientFactory(
        () =>
          ({
            command: {
              list: vi.fn().mockResolvedValue({
                data: mockCommands,
                error: undefined,
              }),
            },
          }) as never,
      );

      const result = await fetchCommands(3000);

      expect(result).toEqual(mockCommands.commands);
    });

    it('returns null when SDK returns error', async () => {
      _setClientFactory(
        () =>
          ({
            command: {
              list: vi.fn().mockResolvedValue({
                data: undefined,
                error: 'API error',
              }),
            },
          }) as never,
      );

      const result = await fetchCommands(3000);

      expect(result).toBeNull();
    });

    it('returns null when fetch throws', async () => {
      _setClientFactory(
        () =>
          ({
            command: {
              list: vi.fn().mockRejectedValue(new Error('Network error')),
            },
          }) as never,
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

      _setClientFactory(
        () =>
          ({
            command: {
              list: vi.fn().mockResolvedValue({
                data: mockCommands,
                error: undefined,
              }),
            },
          }) as never,
      );

      await fetchCommands(3000);
      const cached = getCachedCommands();

      expect(cached).toEqual(mockCommands.commands);
    });
  });

  describe('executeCommand', () => {
    it('executes a command successfully', async () => {
      _setClientFactory(
        () =>
          ({
            session: {
              command: vi.fn().mockResolvedValue({
                data: { success: true },
                error: undefined,
              }),
            },
          }) as never,
      );

      const result = await executeCommand(3000, 'ses_123', 'compact');

      expect(result).toEqual({ ok: true });
    });

    it('executes a command with arguments', async () => {
      const commandMock = vi.fn().mockResolvedValue({
        data: { success: true },
        error: undefined,
      });

      _setClientFactory(
        () =>
          ({
            session: { command: commandMock },
          }) as never,
      );

      const result = await executeCommand(3000, 'ses_123', 'model', {
        model_id: 'claude-opus-4-20250514',
      });

      expect(result).toEqual({ ok: true });
      expect(commandMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionID: 'ses_123',
          command: 'model',
          arguments: 'model_id=claude-opus-4-20250514',
        }),
        expect.any(Object),
      );
    });

    it('returns error when SDK returns error', async () => {
      _setClientFactory(
        () =>
          ({
            session: {
              command: vi.fn().mockResolvedValue({
                data: undefined,
                error: 'Invalid command',
              }),
            },
          }) as never,
      );

      const result = await executeCommand(3000, 'ses_123', 'invalid');

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('returns error when fetch throws', async () => {
      _setClientFactory(
        () =>
          ({
            session: {
              command: vi.fn().mockRejectedValue(new Error('Network error')),
            },
          }) as never,
      );

      const result = await executeCommand(3000, 'ses_123', 'compact');

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
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

      _setClientFactory(
        () =>
          ({
            command: {
              list: vi.fn().mockResolvedValue({
                data: mockCommands,
                error: undefined,
              }),
            },
          }) as never,
      );

      await fetchCommands(3000);
      expect(getCachedCommands()).not.toBeNull();

      clearCommandCache();
      expect(getCachedCommands()).toBeNull();
    });
  });
});
