import { describe, expect, it } from 'vitest';

import {
  getAlwaysModeWarning,
  getInstructionDeliveryMode,
  shouldShowInstructionDeliveryControl,
} from './instruction-delivery';

describe('instruction-delivery', () => {
  it('shows the delivery control only for instructions', () => {
    expect(shouldShowInstructionDeliveryControl('instruction')).toBe(true);
    expect(shouldShowInstructionDeliveryControl('skill')).toBe(false);
  });

  it('defaults missing instruction delivery mode to always', () => {
    expect(getInstructionDeliveryMode({ injectionMode: undefined })).toBe(
      'always',
    );
    expect(getInstructionDeliveryMode({ injectionMode: null })).toBe('always');
  });

  it('preserves catalog delivery mode when provided', () => {
    expect(getInstructionDeliveryMode({ injectionMode: 'catalog' })).toBe(
      'catalog',
    );
  });

  it('only shows always-mode warnings for always-delivered instructions', () => {
    expect(
      getAlwaysModeWarning({
        type: 'instruction',
        injectionMode: 'always',
        alwaysModeWarning: 'Too large for always mode.',
      }),
    ).toBe('Too large for always mode.');

    expect(
      getAlwaysModeWarning({
        type: 'instruction',
        injectionMode: 'catalog',
        alwaysModeWarning: 'Too large for always mode.',
      }),
    ).toBeNull();

    expect(
      getAlwaysModeWarning({
        type: 'skill',
        injectionMode: 'always',
        alwaysModeWarning: 'Too large for always mode.',
      }),
    ).toBeNull();
  });
});
