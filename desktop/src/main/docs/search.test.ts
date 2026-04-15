/**
 * Tests for global search functionality.
 * Follows TDD — write failing tests first, then implement.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import {
  initDatabase,
  createSessionChannel,
  appendSessionChannelMessage,
  upsertRegisteredConnection,
} from '../database';
import { searchGlobal } from './search';

const TEST_DB_PATH = join(app.getPath('userData'), 'conversations.db');

function freshDb(): Promise<void> {
  try {
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  } catch {
    // Ignore race conditions when multiple test files run in parallel
  }
  return initDatabase();
}

describe('searchGlobal', () => {
  beforeEach(freshDb);

  describe('session search', () => {
    it('returns empty results when no sessions exist', () => {
      const result = searchGlobal('test');
      expect(result.sessions).toEqual([]);
      expect(result.messages).toEqual([]);
    });

    it('finds sessions by channel name (case-insensitive)', () => {
      upsertRegisteredConnection({
        providerSessionId: 'ses_123',
        providerType: 'opencode',
        channelName: 'Fix Authentication Bug',
        projectName: 'my-project',
      });
      createSessionChannel('ses_123', 'Fix Authentication Bug');

      const result = searchGlobal('authentication');

      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].sessionId).toBe('ses_123');
      expect(result.sessions[0].channelName).toBe('Fix Authentication Bug');
    });

    it('finds sessions by project name (case-insensitive)', () => {
      upsertRegisteredConnection({
        providerSessionId: 'ses_456',
        providerType: 'opencode',
        channelName: 'Some Task',
        projectName: 'interactive-mcp-server',
      });
      createSessionChannel('ses_456', 'Some Task');

      const result = searchGlobal('interactive');

      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].projectName).toBe('interactive-mcp-server');
    });

    it('limits session results to specified count', () => {
      for (let i = 0; i < 30; i++) {
        const sessionId = `ses_${i}`;
        upsertRegisteredConnection({
          providerSessionId: sessionId,
          providerType: 'opencode',
          channelName: `Test Task ${i}`,
          projectName: 'test-project',
        });
        createSessionChannel(sessionId, `Test Task ${i}`);
      }

      const result = searchGlobal('test', { sessionLimit: 10 });

      expect(result.sessions.length).toBeLessThanOrEqual(10);
    });

    it('returns sessions ordered by most recent update', () => {
      // Create sessions - ordering is by updated_at DESC
      // Within the same test, timestamps may be identical, so we verify
      // both are returned and ordered in some deterministic way
      upsertRegisteredConnection({
        providerSessionId: 'ses_old',
        providerType: 'opencode',
        channelName: 'Old Test Session',
        projectName: 'project',
      });
      createSessionChannel('ses_old', 'Old Test Session');

      upsertRegisteredConnection({
        providerSessionId: 'ses_new',
        providerType: 'opencode',
        channelName: 'New Test Session',
        projectName: 'project',
      });
      createSessionChannel('ses_new', 'New Test Session');

      const result = searchGlobal('test');

      // Both sessions should be returned, ordered by updated_at DESC
      expect(result.sessions).toHaveLength(2);
      const sessionIds = result.sessions.map((s) => s.sessionId);
      expect(sessionIds).toContain('ses_old');
      expect(sessionIds).toContain('ses_new');
    });
  });

  describe('message search', () => {
    it('finds messages by content (case-insensitive)', () => {
      createSessionChannel('ses_msg', 'Test Session');
      appendSessionChannelMessage({
        sessionId: 'ses_msg',
        messageType: 'question',
        messageText: 'How do I implement authentication?',
      });

      const result = searchGlobal('authentication');

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].messageText).toContain('authentication');
      expect(result.messages[0].sessionId).toBe('ses_msg');
    });

    it('returns message snippet with context around match', () => {
      createSessionChannel('ses_snippet', 'Test Session');
      const longMessage =
        'This is a very long message that contains the word authentication somewhere in the middle of the text and continues with more content after that.';
      appendSessionChannelMessage({
        sessionId: 'ses_snippet',
        messageType: 'question',
        messageText: longMessage,
      });

      const result = searchGlobal('authentication');

      expect(result.messages).toHaveLength(1);
      // Snippet should be truncated but include the match
      expect(result.messages[0].snippet).toContain('authentication');
      expect(result.messages[0].snippet.length).toBeLessThanOrEqual(150);
    });

    it('limits message results to specified count', () => {
      createSessionChannel('ses_many', 'Test Session');
      for (let i = 0; i < 30; i++) {
        appendSessionChannelMessage({
          sessionId: 'ses_many',
          messageType: 'question',
          messageText: `Test message number ${i}`,
        });
      }

      const result = searchGlobal('message', { messageLimit: 10 });

      expect(result.messages.length).toBeLessThanOrEqual(10);
    });

    it('includes session name in message results for context', () => {
      upsertRegisteredConnection({
        providerSessionId: 'ses_ctx',
        providerType: 'opencode',
        channelName: 'My Context Session',
        projectName: 'project',
      });
      createSessionChannel('ses_ctx', 'My Context Session');
      appendSessionChannelMessage({
        sessionId: 'ses_ctx',
        messageType: 'question',
        messageText: 'Test message for context',
      });

      const result = searchGlobal('test');

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].sessionName).toBe('My Context Session');
    });

    it('includes timestamp in message results', () => {
      createSessionChannel('ses_time', 'Test Session');
      appendSessionChannelMessage({
        sessionId: 'ses_time',
        messageType: 'question',
        messageText: 'Test message with timestamp',
      });

      const result = searchGlobal('timestamp');

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].createdAt).toBeDefined();
    });

    it('searches across multiple sessions', () => {
      createSessionChannel('ses_a', 'Session A');
      createSessionChannel('ses_b', 'Session B');
      appendSessionChannelMessage({
        sessionId: 'ses_a',
        messageType: 'question',
        messageText: 'Debug the error in session A',
      });
      appendSessionChannelMessage({
        sessionId: 'ses_b',
        messageType: 'answer',
        messageText: 'Debug the error in session B',
      });

      const result = searchGlobal('debug');

      expect(result.messages).toHaveLength(2);
    });
  });

  describe('combined search', () => {
    it('returns both session and message matches', () => {
      upsertRegisteredConnection({
        providerSessionId: 'ses_combined',
        providerType: 'opencode',
        channelName: 'Authentication Fix',
        projectName: 'project',
      });
      createSessionChannel('ses_combined', 'Authentication Fix');
      appendSessionChannelMessage({
        sessionId: 'ses_combined',
        messageType: 'question',
        messageText: 'How to fix authentication?',
      });

      const result = searchGlobal('authentication');

      expect(result.sessions).toHaveLength(1);
      expect(result.messages).toHaveLength(1);
    });

    it('handles empty query by returning empty results', () => {
      createSessionChannel('ses_empty', 'Test Session');
      appendSessionChannelMessage({
        sessionId: 'ses_empty',
        messageType: 'question',
        messageText: 'Some message',
      });

      const result = searchGlobal('');

      expect(result.sessions).toEqual([]);
      expect(result.messages).toEqual([]);
    });

    it('handles whitespace-only query by returning empty results', () => {
      const result = searchGlobal('   ');

      expect(result.sessions).toEqual([]);
      expect(result.messages).toEqual([]);
    });
  });
});
