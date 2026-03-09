import type { TextareaRenderableLike } from './types.js';
import type { RefObject } from 'react';

/**
 * Safely reads text and caret position from textarea.
 * Returns null if textarea is not available or throws an error.
 */
export function safeReadTextarea(
  textareaRef: RefObject<TextareaRenderableLike | null>,
): { value: string; caret: number } | null {
  const textarea = textareaRef.current;
  if (!textarea) {
    return null;
  }

  try {
    return {
      value: textarea.plainText,
      caret: textarea.cursorOffset,
    };
  } catch {
    // Clear the ref if it's stale
    (textareaRef as { current: null }).current = null;
    return null;
  }
}

/**
 * Safely writes text and caret position to textarea.
 * Returns true if successful, false otherwise.
 */
export function safeWriteTextarea(
  textareaRef: RefObject<TextareaRenderableLike | null>,
  nextValue: string,
  nextCaretPosition: number,
): boolean {
  const textarea = textareaRef.current;
  if (!textarea) {
    return false;
  }

  try {
    if (textarea.plainText !== nextValue) {
      textarea.setText(nextValue);
    }

    textarea.cursorOffset = nextCaretPosition;
    return true;
  } catch {
    // Clear the ref if it's stale
    (textareaRef as { current: null }).current = null;
    return false;
  }
}

/**
 * Attempts to focus the textarea.
 * Returns true if successful, false otherwise.
 */
export function focusTextarea(
  textareaRef: RefObject<TextareaRenderableLike | null>,
): boolean {
  const textarea = textareaRef.current as
    | (TextareaRenderableLike & { focus?: () => void })
    | null;

  if (!textarea) {
    return false;
  }

  try {
    textarea.focus?.();
    return true;
  } catch {
    // Clear the ref if it's stale
    (textareaRef as { current: null }).current = null;
    return false;
  }
}
