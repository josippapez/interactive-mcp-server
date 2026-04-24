/**
 * Caches for the documentation context injector hot path.
 *
 * Two independent caches:
 *
 * 1. `DiscoverDocsCache` — TTL cache for `discoverDocs(baseDirectory)` results.
 *    Avoids repeated synchronous fs walks of the same repo within a short
 *    window. Default TTL: 60s.
 *
 * 2. `LRUFileCache` — bounded LRU cache for file content keyed by
 *    `absPath:mtime`. Avoids re-reading unchanged files within a session.
 *    Default capacity: 200 entries.
 *
 * Both caches are pure modules with injectable clocks for testability.
 */

// ── Discover-docs TTL cache ────────────────────────────────────────────────

export interface DiscoverDocsCacheOptions {
  /** TTL in milliseconds. Defaults to 60_000 (60s). */
  ttlMs?: number;
  /** Clock function. Defaults to `Date.now`. */
  now?: () => number;
}

interface DiscoverEntry<T> {
  value: T;
  expiresAt: number;
}

export class DiscoverDocsCache<T> {
  private readonly entries = new Map<string, DiscoverEntry<T>>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: DiscoverDocsCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  /** Returns the cached value if non-expired; otherwise undefined. */
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** Stores `value` for `key` with TTL refresh. */
  set(key: string, value: T): void {
    this.entries.set(key, {
      value,
      expiresAt: this.now() + this.ttlMs,
    });
  }

  /** Forget all entries. Test/dev helper. */
  clear(): void {
    this.entries.clear();
  }

  /** Current entry count (including any not-yet-evicted expired entries). */
  size(): number {
    return this.entries.size;
  }
}

// ── LRU file-content cache ─────────────────────────────────────────────────

export interface LRUFileCacheOptions {
  /** Max entries before eviction. Defaults to 200. */
  capacity?: number;
}

export class LRUFileCache {
  private readonly entries = new Map<string, string>();
  private readonly capacity: number;

  constructor(options: LRUFileCacheOptions = {}) {
    const cap = options.capacity ?? 200;
    if (cap <= 0) {
      throw new Error('LRUFileCache capacity must be > 0');
    }
    this.capacity = cap;
  }

  /** Build the canonical cache key from absPath + mtime. */
  static keyFor(absPath: string, mtimeMs: number): string {
    return `${absPath}:${mtimeMs}`;
  }

  /** Returns cached content; refreshes recency on hit. */
  get(key: string): string | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    // Refresh recency (Map preserves insertion order — re-insert to mark MRU).
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  /** Stores `value`; evicts least-recently-used if at capacity. */
  set(key: string, value: string): void {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    } else if (this.entries.size >= this.capacity) {
      // Evict LRU (first entry in insertion order).
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }
    this.entries.set(key, value);
  }

  /** True if the key is present (does not refresh recency). */
  has(key: string): boolean {
    return this.entries.has(key);
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }
}
