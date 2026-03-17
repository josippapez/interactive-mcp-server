import type { OpenTuiKeyEvent } from './types.js';
import {
  extractPastedText,
  isEnterKey,
  isPrintableCharacter,
  isCopyShortcut,
  isPasteShortcut,
  isReverseTabShortcut,
  isSubmitShortcut,
} from './keyboard.js';

export interface KeyboardRouterDeps {
  // Mode and options
  mode: 'option' | 'input';
  hasOptions: boolean;
  predefinedOptions: string[];
  selectedIndex: number;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;

  // Suggestions
  fileSuggestions: string[];
  selectedSuggestionIndex: number;
  setSelectedSuggestionIndex: React.Dispatch<React.SetStateAction<number>>;

  // Mode switching
  setModeToInput: () => void;
  setModeToOption: () => void;

  // Actions
  submitCurrentSelection: () => void;
  applySelectedSuggestion: () => void;
  insertCharacterInTextarea: (character: string) => void;
  handlePastedText: (text: string) => void;
  pasteClipboardIntoInput: () => void;
  copyInputToClipboard: () => void;

  // Callbacks
  onInputActivity?: () => void;
}

/**
 * Creates a keyboard event handler that routes key events
 * to appropriate actions based on current mode and state.
 */
export function createKeyboardRouter(
  deps: KeyboardRouterDeps,
): (key: OpenTuiKeyEvent) => void {
  const {
    mode,
    hasOptions,
    predefinedOptions,
    setSelectedIndex,
    fileSuggestions,
    setSelectedSuggestionIndex,
    setModeToInput,
    setModeToOption,
    submitCurrentSelection,
    applySelectedSuggestion,
    insertCharacterInTextarea,
    handlePastedText,
    pasteClipboardIntoInput,
    copyInputToClipboard,
    onInputActivity,
  } = deps;

  const consumeHandledKey = (key: OpenTuiKeyEvent) => {
    key.preventDefault?.();
    key.stopPropagation?.();
  };

  return (key: OpenTuiKeyEvent) => {
    // Global shortcuts (work in any mode)
    if (isSubmitShortcut(key)) {
      submitCurrentSelection();
      return;
    }

    const pastedText = extractPastedText(key);
    if (pastedText !== null) {
      if (mode === 'option' && hasOptions) {
        setModeToInput();
      }
      handlePastedText(pastedText);
      return;
    }

    if (isPasteShortcut(key)) {
      pasteClipboardIntoInput();
      return;
    }

    if (isCopyShortcut(key)) {
      copyInputToClipboard();
      return;
    }

    // Input mode with suggestions handling
    if (mode === 'input' && fileSuggestions.length > 0) {
      const isForwardTabShortcut =
        key.name === 'tab' && !isReverseTabShortcut(key);

      if (isForwardTabShortcut || isEnterKey(key)) {
        consumeHandledKey(key);
        applySelectedSuggestion();
        return;
      }

      if ((key.ctrl || key.meta) && key.name.toLowerCase() === 'n') {
        consumeHandledKey(key);
        setSelectedSuggestionIndex(
          (previous) => (previous + 1) % fileSuggestions.length,
        );
        onInputActivity?.();
        return;
      }

      if ((key.ctrl || key.meta) && key.name.toLowerCase() === 'p') {
        consumeHandledKey(key);
        setSelectedSuggestionIndex((previous) =>
          previous <= 0 ? fileSuggestions.length - 1 : previous - 1,
        );
        onInputActivity?.();
        return;
      }

      if (key.name === 'down') {
        consumeHandledKey(key);
        setSelectedSuggestionIndex(
          (previous) => (previous + 1) % fileSuggestions.length,
        );
        onInputActivity?.();
        return;
      }

      if (key.name === 'up') {
        consumeHandledKey(key);
        setSelectedSuggestionIndex((previous) =>
          previous <= 0 ? fileSuggestions.length - 1 : previous - 1,
        );
        onInputActivity?.();
        return;
      }
    }

    // Tab/Shift+Tab for mode switching
    if (hasOptions && (isReverseTabShortcut(key) || key.name === 'tab')) {
      if (mode === 'option') {
        setModeToInput();
      } else {
        setModeToOption();
      }
      return;
    }

    // Option mode handling
    if (mode === 'option' && hasOptions) {
      if (isEnterKey(key)) {
        submitCurrentSelection();
        return;
      }

      if (key.name === 'right') {
        setModeToInput();
        return;
      }

      if (key.name === 'left') {
        setModeToOption();
        return;
      }

      if (key.name === 'up' || key.name.toLowerCase() === 'k') {
        setSelectedIndex(
          (previous) =>
            (previous - 1 + predefinedOptions.length) %
            predefinedOptions.length,
        );
        onInputActivity?.();
        return;
      }

      if (key.name === 'down' || key.name.toLowerCase() === 'j') {
        setSelectedIndex(
          (previous) => (previous + 1) % predefinedOptions.length,
        );
        onInputActivity?.();
        return;
      }

      const typedCharacter = isPrintableCharacter(key);
      if (typedCharacter !== null) {
        setModeToInput();
        insertCharacterInTextarea(typedCharacter);
      }
      return;
    }
  };
}
