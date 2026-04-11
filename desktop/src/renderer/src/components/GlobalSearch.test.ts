import { describe, it, expect } from 'vitest';
import {
  highlightMatches,
  flattenResults,
  type GlobalSearchResult,
} from './GlobalSearch';

// ===========================================================================
// highlightMatches
// ===========================================================================

describe('highlightMatches', () => {
  it('returns whole text as non-highlighted when query is empty', () => {
    const result = highlightMatches('Hello World', '');
    expect(result).toEqual([{ text: 'Hello World', highlight: false }]);
  });

  it('returns whole text as non-highlighted when query is whitespace only', () => {
    const result = highlightMatches('Hello World', '   ');
    expect(result).toEqual([{ text: 'Hello World', highlight: false }]);
  });

  it('highlights a single match at the start', () => {
    const result = highlightMatches('Hello World', 'Hello');
    expect(result).toEqual([
      { text: 'Hello', highlight: true },
      { text: ' World', highlight: false },
    ]);
  });

  it('highlights a single match at the end', () => {
    const result = highlightMatches('Hello World', 'World');
    expect(result).toEqual([
      { text: 'Hello ', highlight: false },
      { text: 'World', highlight: true },
    ]);
  });

  it('highlights a single match in the middle', () => {
    const result = highlightMatches('Hello World', 'lo Wo');
    expect(result).toEqual([
      { text: 'Hel', highlight: false },
      { text: 'lo Wo', highlight: true },
      { text: 'rld', highlight: false },
    ]);
  });

  it('highlights multiple matches', () => {
    const result = highlightMatches('test test test', 'test');
    expect(result).toHaveLength(5); // test + space + test + space + test
    expect(result[0]).toEqual({ text: 'test', highlight: true });
    expect(result[2]).toEqual({ text: 'test', highlight: true });
    expect(result[4]).toEqual({ text: 'test', highlight: true });
  });

  it('performs case-insensitive matching', () => {
    const result = highlightMatches('Hello World', 'HELLO');
    expect(result).toEqual([
      { text: 'Hello', highlight: true },
      { text: ' World', highlight: false },
    ]);
  });

  it('handles no match by returning non-highlighted text', () => {
    const result = highlightMatches('Hello World', 'xyz');
    expect(result).toEqual([{ text: 'Hello World', highlight: false }]);
  });

  it('handles text equal to query', () => {
    const result = highlightMatches('test', 'test');
    expect(result).toEqual([{ text: 'test', highlight: true }]);
  });
});

// ===========================================================================
// flattenResults
// ===========================================================================

describe('flattenResults', () => {
  it('returns empty array for empty results', () => {
    const results: GlobalSearchResult = { sessions: [], messages: [] };
    const flat = flattenResults(results);
    expect(flat).toEqual([]);
  });

  it('flattens sessions first, then messages', () => {
    const results: GlobalSearchResult = {
      sessions: [
        {
          sessionId: 'ses_1',
          channelName: 'Session A',
          projectName: 'proj',
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
        {
          sessionId: 'ses_2',
          channelName: 'Session B',
          projectName: 'proj',
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
      ],
      messages: [
        {
          id: 1,
          sessionId: 'ses_1',
          sessionName: 'Session A',
          messageType: 'question',
          messageText: 'Hello',
          snippet: 'Hello',
          createdAt: '2024-01-01',
        },
      ],
    };

    const flat = flattenResults(results);

    expect(flat).toHaveLength(3);
    expect(flat[0].type).toBe('session');
    expect(flat[1].type).toBe('session');
    expect(flat[2].type).toBe('message');
  });

  it('preserves order within each category', () => {
    const results: GlobalSearchResult = {
      sessions: [
        {
          sessionId: 'ses_1',
          channelName: 'First',
          projectName: 'proj',
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
        {
          sessionId: 'ses_2',
          channelName: 'Second',
          projectName: 'proj',
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
      ],
      messages: [],
    };

    const flat = flattenResults(results);

    expect(flat[0].data).toMatchObject({ channelName: 'First' });
    expect(flat[1].data).toMatchObject({ channelName: 'Second' });
  });

  it('handles only sessions', () => {
    const results: GlobalSearchResult = {
      sessions: [
        {
          sessionId: 'ses_1',
          channelName: 'Session',
          projectName: 'proj',
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
      ],
      messages: [],
    };

    const flat = flattenResults(results);

    expect(flat).toHaveLength(1);
    expect(flat[0].type).toBe('session');
  });

  it('handles only messages', () => {
    const results: GlobalSearchResult = {
      sessions: [],
      messages: [
        {
          id: 1,
          sessionId: 'ses_1',
          sessionName: 'Session',
          messageType: 'answer',
          messageText: 'Response',
          snippet: 'Response',
          createdAt: '2024-01-01',
        },
      ],
    };

    const flat = flattenResults(results);

    expect(flat).toHaveLength(1);
    expect(flat[0].type).toBe('message');
  });
});
