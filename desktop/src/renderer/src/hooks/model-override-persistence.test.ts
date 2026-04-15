/**
 * Tests for model-override-persistence — localStorage persistence for per-session model overrides.
 *
 * Following TDD: write tests first, then implement.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  STORAGE_KEY,
  loadModelOverrides,
  saveModelOverrides,
  type PersistedModelOverride,
} from './model-override-persistence';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

describe('model-override-persistence', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe('loadModelOverrides', () => {
    it('returns empty Map when localStorage has no data', () => {
      const result = loadModelOverrides();
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it('returns empty Map when localStorage has invalid JSON', () => {
      localStorageMock.setItem(STORAGE_KEY, 'not-json');
      const result = loadModelOverrides();
      expect(result.size).toBe(0);
    });

    it('returns empty Map when localStorage has non-object JSON', () => {
      localStorageMock.setItem(STORAGE_KEY, '"string"');
      const result = loadModelOverrides();
      expect(result.size).toBe(0);
    });

    it('loads valid overrides from localStorage', () => {
      const data: Record<string, PersistedModelOverride> = {
        ses_abc123: {
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-20250514',
          variant: 'high',
        },
        ses_def456: {
          providerId: 'openai',
          modelId: 'gpt-4o',
        },
      };
      localStorageMock.setItem(STORAGE_KEY, JSON.stringify(data));

      const result = loadModelOverrides();
      expect(result.size).toBe(2);
      expect(result.get('ses_abc123')).toEqual({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-20250514',
        variant: 'high',
      });
      expect(result.get('ses_def456')).toEqual({
        providerId: 'openai',
        modelId: 'gpt-4o',
      });
    });

    it('skips entries missing required fields', () => {
      const data = {
        ses_valid: {
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-20250514',
        },
        ses_no_provider: {
          modelId: 'claude-sonnet-4-20250514',
        },
        ses_no_model: {
          providerId: 'anthropic',
        },
        ses_empty: {},
      };
      localStorageMock.setItem(STORAGE_KEY, JSON.stringify(data));

      const result = loadModelOverrides();
      expect(result.size).toBe(1);
      expect(result.has('ses_valid')).toBe(true);
    });

    it('preserves undefined variant when not present', () => {
      const data = {
        ses_abc: {
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-20250514',
        },
      };
      localStorageMock.setItem(STORAGE_KEY, JSON.stringify(data));

      const result = loadModelOverrides();
      expect(result.get('ses_abc')?.variant).toBeUndefined();
    });
  });

  describe('saveModelOverrides', () => {
    it('saves an empty Map as empty object', () => {
      saveModelOverrides(new Map());
      expect(localStorageMock.setItem).toHaveBeenCalledWith(STORAGE_KEY, '{}');
    });

    it('saves overrides to localStorage', () => {
      const map = new Map<string, PersistedModelOverride>();
      map.set('ses_abc', {
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-20250514',
        variant: 'high',
      });
      map.set('ses_def', {
        providerId: 'openai',
        modelId: 'gpt-4o',
      });

      saveModelOverrides(map);

      const saved = JSON.parse(
        localStorageMock.getItem(STORAGE_KEY)!,
      ) as Record<string, PersistedModelOverride>;
      expect(saved).toEqual({
        ses_abc: {
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-20250514',
          variant: 'high',
        },
        ses_def: {
          providerId: 'openai',
          modelId: 'gpt-4o',
        },
      });
    });

    it('does not throw when localStorage is unavailable', () => {
      const originalSetItem = localStorageMock.setItem;
      localStorageMock.setItem = vi.fn(() => {
        throw new Error('quota exceeded');
      });

      const map = new Map<string, PersistedModelOverride>();
      map.set('ses_abc', {
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-20250514',
      });

      expect(() => saveModelOverrides(map)).not.toThrow();

      localStorageMock.setItem = originalSetItem;
    });
  });
});
