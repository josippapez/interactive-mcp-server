import { describe, it, expect } from 'vitest';
import { computeStagedSlice, computeInitialBatch } from './useStaging';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeItems(count: number): { id: string; text: string }[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `item-${i}`,
    text: `Message ${i}`,
  }));
}

// ── computeStagedSlice ───────────────────────────────────────────────────────

describe('computeStagedSlice', () => {
  it('returns all items when stagedCount >= items.length', () => {
    const items = makeItems(10);
    const result = computeStagedSlice(items, 10);
    expect(result).toBe(items); // identity — no copy
  });

  it('returns all items when stagedCount exceeds items.length', () => {
    const items = makeItems(5);
    const result = computeStagedSlice(items, 20);
    expect(result).toBe(items);
  });

  it('returns the LAST N items when stagedCount < items.length', () => {
    const items = makeItems(50);
    const result = computeStagedSlice(items, 20);
    expect(result).toHaveLength(20);
    // Should be the last 20 items (newest messages)
    expect(result[0]).toEqual({ id: 'item-30', text: 'Message 30' });
    expect(result[19]).toEqual({ id: 'item-49', text: 'Message 49' });
  });

  it('returns empty array when stagedCount is 0', () => {
    const items = makeItems(10);
    const result = computeStagedSlice(items, 0);
    expect(result).toHaveLength(0);
  });

  it('returns empty array for empty items', () => {
    const result = computeStagedSlice([], 0);
    expect(result).toEqual([]);
  });
});

// ── computeInitialBatch ──────────────────────────────────────────────────────

describe('computeInitialBatch', () => {
  it('returns all items when below staging threshold', () => {
    const result = computeInitialBatch(25, {
      enabled: true,
      stagingThreshold: 30,
      initialBatch: 20,
    });
    expect(result).toEqual({ count: 25, needsStaging: false });
  });

  it('returns all items when staging is disabled', () => {
    const result = computeInitialBatch(100, {
      enabled: false,
      stagingThreshold: 30,
      initialBatch: 20,
    });
    expect(result).toEqual({ count: 100, needsStaging: false });
  });

  it('returns initial batch size for large lists', () => {
    const result = computeInitialBatch(100, {
      enabled: true,
      stagingThreshold: 30,
      initialBatch: 20,
    });
    expect(result).toEqual({ count: 20, needsStaging: true });
  });

  it('clamps initial batch to items.length when initialBatch > items.length', () => {
    const result = computeInitialBatch(35, {
      enabled: true,
      stagingThreshold: 30,
      initialBatch: 50,
    });
    expect(result).toEqual({ count: 35, needsStaging: false });
  });

  it('returns 0 for empty items', () => {
    const result = computeInitialBatch(0, {
      enabled: true,
      stagingThreshold: 30,
      initialBatch: 20,
    });
    expect(result).toEqual({ count: 0, needsStaging: false });
  });

  it('uses exact threshold boundary correctly (items = threshold → no staging)', () => {
    const result = computeInitialBatch(30, {
      enabled: true,
      stagingThreshold: 30,
      initialBatch: 20,
    });
    // Exactly at threshold → no staging (threshold is "more than")
    expect(result).toEqual({ count: 30, needsStaging: false });
  });

  it('stages at threshold + 1', () => {
    const result = computeInitialBatch(31, {
      enabled: true,
      stagingThreshold: 30,
      initialBatch: 20,
    });
    expect(result).toEqual({ count: 20, needsStaging: true });
  });
});
