import { describe, expect, it } from 'vitest';
import { DiscoverDocsCache, LRUFileCache } from './context-injector-cache';

describe('DiscoverDocsCache', () => {
  it('returns undefined for missing keys', () => {
    const cache = new DiscoverDocsCache<string[]>();
    expect(cache.get('/repo')).toBeUndefined();
  });

  it('stores and retrieves a value within TTL', () => {
    let now = 1000;
    const cache = new DiscoverDocsCache<string[]>({
      ttlMs: 60_000,
      now: () => now,
    });
    cache.set('/repo', ['a.md', 'b.md']);
    now = 30_000; // halfway through TTL
    expect(cache.get('/repo')).toEqual(['a.md', 'b.md']);
  });

  it('expires entries after the TTL elapses', () => {
    let now = 0;
    const cache = new DiscoverDocsCache<string[]>({
      ttlMs: 60_000,
      now: () => now,
    });
    cache.set('/repo', ['a.md']);
    now = 60_001;
    expect(cache.get('/repo')).toBeUndefined();
    // Expired entry was evicted on access
    expect(cache.size()).toBe(0);
  });

  it('refreshes TTL on each set', () => {
    let now = 0;
    const cache = new DiscoverDocsCache<string[]>({
      ttlMs: 1000,
      now: () => now,
    });
    cache.set('/repo', ['v1']);
    now = 500;
    cache.set('/repo', ['v2']);
    now = 1400; // 900ms after the second set
    expect(cache.get('/repo')).toEqual(['v2']);
  });

  it('keeps entries per baseDirectory key independent', () => {
    const cache = new DiscoverDocsCache<string[]>();
    cache.set('/repo-a', ['a']);
    cache.set('/repo-b', ['b']);
    expect(cache.get('/repo-a')).toEqual(['a']);
    expect(cache.get('/repo-b')).toEqual(['b']);
  });

  it('clear() drops all entries', () => {
    const cache = new DiscoverDocsCache<string[]>();
    cache.set('/r', ['x']);
    cache.clear();
    expect(cache.get('/r')).toBeUndefined();
    expect(cache.size()).toBe(0);
  });
});

describe('LRUFileCache', () => {
  it('returns undefined for missing keys', () => {
    const cache = new LRUFileCache();
    expect(cache.get('missing')).toBeUndefined();
  });

  it('stores and retrieves content by absPath:mtime key', () => {
    const cache = new LRUFileCache();
    const key = LRUFileCache.keyFor('/abs/path/file.md', 12345);
    cache.set(key, 'contents');
    expect(cache.get(key)).toBe('contents');
  });

  it('treats different mtimes as cache misses for the same path', () => {
    const cache = new LRUFileCache();
    cache.set(LRUFileCache.keyFor('/file.md', 100), 'old');
    expect(cache.get(LRUFileCache.keyFor('/file.md', 200))).toBeUndefined();
  });

  it('evicts least-recently-used entries past capacity', () => {
    const cache = new LRUFileCache({ capacity: 3 });
    cache.set('a', 'A');
    cache.set('b', 'B');
    cache.set('c', 'C');
    cache.set('d', 'D'); // evicts 'a'
    expect(cache.has('a')).toBe(false);
    expect(cache.get('b')).toBe('B');
    expect(cache.get('c')).toBe('C');
    expect(cache.get('d')).toBe('D');
    expect(cache.size()).toBe(3);
  });

  it('refreshes recency on get so the most recent entry is not evicted', () => {
    const cache = new LRUFileCache({ capacity: 3 });
    cache.set('a', 'A');
    cache.set('b', 'B');
    cache.set('c', 'C');
    // Touch 'a' so 'b' becomes LRU.
    expect(cache.get('a')).toBe('A');
    cache.set('d', 'D'); // should evict 'b'
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
  });

  it('overwriting an existing key does not bypass capacity', () => {
    const cache = new LRUFileCache({ capacity: 2 });
    cache.set('a', 'A');
    cache.set('b', 'B');
    cache.set('a', 'A2'); // overwrite, not new entry
    expect(cache.size()).toBe(2);
    expect(cache.get('a')).toBe('A2');
    expect(cache.get('b')).toBe('B');
  });

  it('throws on non-positive capacity', () => {
    expect(() => new LRUFileCache({ capacity: 0 })).toThrow();
    expect(() => new LRUFileCache({ capacity: -5 })).toThrow();
  });

  it('keyFor produces the expected canonical format', () => {
    expect(LRUFileCache.keyFor('/foo/bar.md', 42)).toBe('/foo/bar.md:42');
  });

  it('clear() empties the cache', () => {
    const cache = new LRUFileCache({ capacity: 5 });
    cache.set('a', 'A');
    cache.set('b', 'B');
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });
});
