import type { OpenTuiKeyEvent } from './types.js';

const CTRL_MODIFIED_KEY_CSI_U_SEQUENCE = new RegExp(
  `^${String.fromCharCode(27)}\\[(\\d+);(\\d+)u$`,
);

const hasCtrlOrMetaModifier = (modifierCode: number): boolean => {
  const modifierFlags = modifierCode - 1;
  const includesCtrl = (modifierFlags & 4) !== 0;
  const includesMeta = (modifierFlags & 8) !== 0;
  return includesCtrl || includesMeta;
};

export const isControlKeyShortcut = (
  key: OpenTuiKeyEvent,
  letter: string,
): boolean => {
  const lowerName = key.name.toLowerCase();
  if ((key.ctrl || key.meta) && lowerName === letter) {
    return true;
  }

  const csiUMatch = key.sequence.match(CTRL_MODIFIED_KEY_CSI_U_SEQUENCE);
  if (!csiUMatch) {
    return false;
  }

  const keyCode = Number(csiUMatch[1]);
  const modifierCode = Number(csiUMatch[2]);
  const lowercaseKeyCode = letter.charCodeAt(0);
  const uppercaseKeyCode = letter.toUpperCase().charCodeAt(0);

  return (
    (keyCode === lowercaseKeyCode || keyCode === uppercaseKeyCode) &&
    hasCtrlOrMetaModifier(modifierCode)
  );
};

export const isSubmitShortcut = (key: OpenTuiKeyEvent): boolean =>
  isControlKeyShortcut(key, 's');

export const isCopyShortcut = (key: OpenTuiKeyEvent): boolean =>
  isControlKeyShortcut(key, 'c') ||
  (key.ctrl && key.shift && key.name.toLowerCase() === 'c');

export const isPasteShortcut = (key: OpenTuiKeyEvent): boolean =>
  isControlKeyShortcut(key, 'v') ||
  (key.ctrl && key.shift && key.name.toLowerCase() === 'v');

export const isReverseTabShortcut = (key: OpenTuiKeyEvent): boolean =>
  key.name === 'backtab' ||
  (key.name === 'tab' && key.shift) ||
  key.sequence === '\u001b[Z';

export const isPrintableCharacter = (key: OpenTuiKeyEvent): string | null => {
  if (key.ctrl || key.meta || key.option || key.name === 'tab') {
    return null;
  }

  if (key.name === 'space') {
    return ' ';
  }

  if (key.sequence.length === 1 && key.sequence >= ' ') {
    return key.sequence;
  }

  if (key.name.length === 1) {
    return key.shift ? key.name.toUpperCase() : key.name;
  }

  return null;
};

export const extractPastedText = (key: OpenTuiKeyEvent): string | null => {
  if (key.ctrl || key.meta || key.option || key.sequence.length <= 1) {
    return null;
  }

  for (const character of key.sequence) {
    const code = character.charCodeAt(0);
    const isAllowedControl = code === 9 || code === 10 || code === 13;
    if (!isAllowedControl && code < 32) {
      return null;
    }
  }

  return key.sequence;
};

export const textareaKeyBindings: Array<{
  name: string;
  ctrl?: boolean;
  meta?: boolean;
  super?: boolean;
  shift?: boolean;
  action: 'submit' | 'newline' | 'select-all';
}> = [
  { name: 's', ctrl: true, action: 'submit' },
  { name: 's', meta: true, action: 'submit' },
  { name: 's', super: true, action: 'submit' },
  { name: 'a', ctrl: true, action: 'select-all' },
  { name: 'a', meta: true, action: 'select-all' },
  { name: 'a', super: true, action: 'select-all' },
  { name: 'j', ctrl: true, action: 'newline' },
];
