import { describe, expect, it } from 'bun:test';
import { createKeyboardRouter } from './keyboard-router.js';
import type { OpenTuiKeyEvent } from './types.js';

interface RouterHarness {
  handle: (key: OpenTuiKeyEvent) => void;
  getSelectedSuggestionIndex: () => number;
  getApplyCount: () => number;
  getSetModeToOptionCount: () => number;
  getInputActivityCount: () => number;
}

const createRouterHarness = (overrides?: {
  hasOptions?: boolean;
  mode?: 'option' | 'input';
  fileSuggestions?: string[];
  selectedSuggestionIndex?: number;
}): RouterHarness => {
  let selectedIndex = 0;
  let selectedSuggestionIndex = overrides?.selectedSuggestionIndex ?? 0;
  let applyCount = 0;
  let setModeToOptionCount = 0;
  let inputActivityCount = 0;

  const handle = createKeyboardRouter({
    mode: overrides?.mode ?? 'input',
    hasOptions: overrides?.hasOptions ?? false,
    predefinedOptions: ['one', 'two'],
    selectedIndex: 0,
    setSelectedIndex: (next) => {
      selectedIndex = typeof next === 'function' ? next(selectedIndex) : next;
    },
    fileSuggestions: overrides?.fileSuggestions ?? [
      'src/index.ts',
      'src/ui.tsx',
    ],
    selectedSuggestionIndex,
    setSelectedSuggestionIndex: (next) => {
      selectedSuggestionIndex =
        typeof next === 'function' ? next(selectedSuggestionIndex) : next;
    },
    setModeToInput: () => {},
    setModeToOption: () => {
      setModeToOptionCount += 1;
    },
    submitCurrentSelection: () => {},
    applySelectedSuggestion: () => {
      applyCount += 1;
    },
    insertCharacterInTextarea: () => {},
    handlePastedText: () => {},
    pasteClipboardIntoInput: () => {},
    copyInputToClipboard: () => {},
    onInputActivity: () => {
      inputActivityCount += 1;
    },
  });

  return {
    handle,
    getSelectedSuggestionIndex: () => selectedSuggestionIndex,
    getApplyCount: () => applyCount,
    getSetModeToOptionCount: () => setModeToOptionCount,
    getInputActivityCount: () => inputActivityCount,
  };
};

const createTrackedKey = (
  overrides: Partial<OpenTuiKeyEvent>,
): {
  key: OpenTuiKeyEvent;
  wasDefaultPrevented: () => boolean;
  wasPropagationStopped: () => boolean;
} => {
  let defaultPrevented = false;
  let propagationStopped = false;

  const key: OpenTuiKeyEvent = {
    name: '',
    sequence: '',
    ctrl: false,
    shift: false,
    meta: false,
    option: false,
    preventDefault: () => {
      defaultPrevented = true;
    },
    stopPropagation: () => {
      propagationStopped = true;
    },
    ...overrides,
  };

  return {
    key,
    wasDefaultPrevented: () => defaultPrevented,
    wasPropagationStopped: () => propagationStopped,
  };
};

describe('createKeyboardRouter - input suggestions', () => {
  it('consumes arrow navigation keys so textarea does not also handle them', () => {
    const harness = createRouterHarness();
    const trackedKey = createTrackedKey({ name: 'down', sequence: '\u001b[B' });

    harness.handle(trackedKey.key);

    expect(harness.getSelectedSuggestionIndex()).toBe(1);
    expect(harness.getInputActivityCount()).toBe(1);
    expect(trackedKey.wasDefaultPrevented()).toBe(true);
    expect(trackedKey.wasPropagationStopped()).toBe(true);
  });

  it('applies the highlighted suggestion with enter and consumes the key event', () => {
    const harness = createRouterHarness();
    const trackedKey = createTrackedKey({ name: 'enter', sequence: '\r' });

    harness.handle(trackedKey.key);

    expect(harness.getApplyCount()).toBe(1);
    expect(trackedKey.wasDefaultPrevented()).toBe(true);
    expect(trackedKey.wasPropagationStopped()).toBe(true);
  });

  it('applies suggestion with tab even when options are available', () => {
    const harness = createRouterHarness({ hasOptions: true });
    const trackedKey = createTrackedKey({ name: 'tab', sequence: '\t' });

    harness.handle(trackedKey.key);

    expect(harness.getApplyCount()).toBe(1);
    expect(harness.getSetModeToOptionCount()).toBe(0);
    expect(trackedKey.wasDefaultPrevented()).toBe(true);
    expect(trackedKey.wasPropagationStopped()).toBe(true);
  });
});
