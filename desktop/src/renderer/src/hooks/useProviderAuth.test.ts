import { describe, it, expect } from 'vitest';
import {
  evaluateWhenCondition,
  getNextPromptKey,
  filterVisiblePrompts,
  areAllPromptsAnswered,
} from './useProviderAuth';
import type { AuthPrompt } from '../../../preload/index';

describe('useProviderAuth pure helpers', () => {
  // ─── evaluateWhenCondition ───────────────────────────────────────────────

  describe('evaluateWhenCondition', () => {
    it('returns true when no condition is provided', () => {
      expect(evaluateWhenCondition(undefined, {})).toBe(true);
    });

    it('returns true when eq condition matches', () => {
      expect(
        evaluateWhenCondition(
          { key: 'region', op: 'eq', value: 'us' },
          { region: 'us' },
        ),
      ).toBe(true);
    });

    it('returns false when eq condition does not match', () => {
      expect(
        evaluateWhenCondition(
          { key: 'region', op: 'eq', value: 'us' },
          { region: 'eu' },
        ),
      ).toBe(false);
    });

    it('returns true when neq condition matches', () => {
      expect(
        evaluateWhenCondition(
          { key: 'region', op: 'neq', value: 'us' },
          { region: 'eu' },
        ),
      ).toBe(true);
    });

    it('returns false when neq condition does not match', () => {
      expect(
        evaluateWhenCondition(
          { key: 'region', op: 'neq', value: 'us' },
          { region: 'us' },
        ),
      ).toBe(false);
    });

    it('treats missing key as empty string for eq', () => {
      expect(
        evaluateWhenCondition({ key: 'region', op: 'eq', value: '' }, {}),
      ).toBe(true);
    });

    it('treats missing key as empty string for neq', () => {
      expect(
        evaluateWhenCondition({ key: 'region', op: 'neq', value: 'us' }, {}),
      ).toBe(true);
    });
  });

  // ─── getNextPromptKey ────────────────────────────────────────────────────

  describe('getNextPromptKey', () => {
    const prompts: AuthPrompt[] = [
      { type: 'text', key: 'email', message: 'Enter email' },
      { type: 'text', key: 'region', message: 'Select region' },
      {
        type: 'text',
        key: 'zone',
        message: 'Enter zone',
        when: { key: 'region', op: 'eq', value: 'us' },
      },
    ];

    it('returns first prompt key when no inputs', () => {
      expect(getNextPromptKey(prompts, {})).toBe('email');
    });

    it('returns second prompt key when first is answered', () => {
      expect(getNextPromptKey(prompts, { email: 'test@example.com' })).toBe(
        'region',
      );
    });

    it('skips conditional prompt when condition not met', () => {
      expect(
        getNextPromptKey(prompts, {
          email: 'test@example.com',
          region: 'eu',
        }),
      ).toBe(null);
    });

    it('returns conditional prompt when condition is met', () => {
      expect(
        getNextPromptKey(prompts, {
          email: 'test@example.com',
          region: 'us',
        }),
      ).toBe('zone');
    });

    it('returns null when all prompts are answered', () => {
      expect(
        getNextPromptKey(prompts, {
          email: 'test@example.com',
          region: 'us',
          zone: 'us-east-1',
        }),
      ).toBe(null);
    });
  });

  // ─── filterVisiblePrompts ────────────────────────────────────────────────

  describe('filterVisiblePrompts', () => {
    const prompts: AuthPrompt[] = [
      { type: 'text', key: 'email', message: 'Enter email' },
      {
        type: 'text',
        key: 'code',
        message: 'Enter code',
        when: { key: 'email', op: 'neq', value: '' },
      },
    ];

    it('returns all unconditional prompts', () => {
      const visible = filterVisiblePrompts(prompts, {});
      expect(visible).toHaveLength(1);
      expect(visible[0].key).toBe('email');
    });

    it('includes conditional prompts when condition is met', () => {
      const visible = filterVisiblePrompts(prompts, {
        email: 'test@example.com',
      });
      expect(visible).toHaveLength(2);
    });
  });

  // ─── areAllPromptsAnswered ───────────────────────────────────────────────

  describe('areAllPromptsAnswered', () => {
    const prompts: AuthPrompt[] = [
      { type: 'text', key: 'apiKey', message: 'Enter API key' },
    ];

    it('returns false when prompts are unanswered', () => {
      expect(areAllPromptsAnswered(prompts, {})).toBe(false);
    });

    it('returns true when all prompts are answered', () => {
      expect(areAllPromptsAnswered(prompts, { apiKey: 'sk-xxx' })).toBe(true);
    });

    it('handles empty prompts array', () => {
      expect(areAllPromptsAnswered([], {})).toBe(true);
    });

    it('correctly handles conditional prompts', () => {
      const conditionalPrompts: AuthPrompt[] = [
        { type: 'text', key: 'email', message: 'Enter email' },
        {
          type: 'text',
          key: 'backup',
          message: 'Enter backup',
          when: { key: 'email', op: 'eq', value: 'admin@example.com' },
        },
      ];

      // Not admin - backup prompt is skipped
      expect(
        areAllPromptsAnswered(conditionalPrompts, {
          email: 'user@example.com',
        }),
      ).toBe(true);

      // Admin - backup prompt is required
      expect(
        areAllPromptsAnswered(conditionalPrompts, {
          email: 'admin@example.com',
        }),
      ).toBe(false);

      // Admin with backup - all answered
      expect(
        areAllPromptsAnswered(conditionalPrompts, {
          email: 'admin@example.com',
          backup: 'backup@example.com',
        }),
      ).toBe(true);
    });
  });
});
