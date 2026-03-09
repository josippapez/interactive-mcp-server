import * as OpenTuiReact from '@opentui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  getAutocompleteTarget,
  rankFileSuggestions,
  readRepositoryFiles,
} from './interactive-input/autocomplete.js';
import {
  extractPastedText,
  isPrintableCharacter,
  isCopyShortcut,
  isPasteShortcut,
  isReverseTabShortcut,
  isSubmitShortcut,
  textareaKeyBindings,
} from './interactive-input/keyboard.js';
import {
  InputEditor,
  ModeTabs,
  OptionList,
  SuggestionsPanel,
} from './interactive-input/sections.js';
import { getTextareaDimensions } from './interactive-input/textarea-height.js';
import type {
  AutocompleteTarget,
  InteractiveInputProps,
  OpenTuiKeyEvent,
  TextareaRenderableLike,
} from './interactive-input/types.js';
import { MarkdownText } from './MarkdownText.js';
import {
  copyTextToClipboard,
  readFilePathsFromClipboard,
  readImageDataUrlFromClipboard,
  readTextFromClipboard,
} from '@/utils/clipboard.js';

const { useKeyboard } = OpenTuiReact as unknown as {
  useKeyboard: (handler: (key: OpenTuiKeyEvent) => void) => void;
};

const { useTerminalDimensions } = OpenTuiReact as unknown as {
  useTerminalDimensions: () => { width: number; height: number };
};

const repositoryFileCache = new Map<string, string[]>();
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};
const IMAGE_EMBED_MAX_BYTES = 2 * 1024 * 1024;
const TEXT_EMBED_MAX_BYTES = 512 * 1024;
const TEXT_EMBED_MAX_CHARS = 20000;
const COLLAPSE_TEXT_PASTE_CHARS = 800;
const COLLAPSE_TEXT_PASTE_LINES = 12;

interface QueuedAttachment {
  id: string;
  label: string;
  payload: string;
}

const inferCodeFenceLanguage = (fileName: string): string => {
  const extension = path.extname(fileName).slice(1).toLowerCase();
  const mapping: Record<string, string> = {
    js: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    tsx: 'tsx',
    json: 'json',
    md: 'markdown',
    py: 'python',
    sh: 'bash',
    yml: 'yaml',
    yaml: 'yaml',
    html: 'html',
    css: 'css',
    go: 'go',
    rs: 'rust',
    java: 'java',
    cs: 'csharp',
  };
  return mapping[extension] ?? '';
};

const normalizeClipboardPath = (
  clipboardText: string,
  searchRoot?: string,
): string | null => {
  const trimmed = clipboardText.trim();
  if (!trimmed) {
    return null;
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let candidate = lines[0] ?? '';
  if (!candidate) {
    return null;
  }
  if (
    (candidate.startsWith('"') && candidate.endsWith('"')) ||
    (candidate.startsWith("'") && candidate.endsWith("'"))
  ) {
    candidate = candidate.slice(1, -1);
  }

  if (candidate.startsWith('file://')) {
    candidate = decodeURIComponent(candidate.replace(/^file:\/\//, ''));
  }

  if (path.isAbsolute(candidate)) {
    return candidate;
  }

  if (!searchRoot) {
    return null;
  }

  return path.resolve(searchRoot, candidate);
};

const isLikelyTextBuffer = (buffer: Buffer): boolean => {
  if (buffer.includes(0)) {
    return false;
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 2048));
  let suspiciousBytes = 0;
  for (const byte of sample) {
    const isPrintableAscii = byte >= 32 && byte <= 126;
    const isWhitespace = byte === 9 || byte === 10 || byte === 13;
    const isExtendedUtf8Byte = byte >= 128;
    if (!isPrintableAscii && !isWhitespace && !isExtendedUtf8Byte) {
      suspiciousBytes += 1;
    }
  }

  return suspiciousBytes < 8;
};

const shouldCollapsePastedText = (text: string): boolean =>
  text.length >= COLLAPSE_TEXT_PASTE_CHARS ||
  text.split(/\r?\n/).length >= COLLAPSE_TEXT_PASTE_LINES;

const buildAttachmentFromPath = async (
  absolutePath: string,
): Promise<QueuedAttachment> => {
  const fileStats = await fs.stat(absolutePath);
  if (!fileStats.isFile()) {
    throw new Error('Clipboard path is not a file');
  }

  const fileName = path.basename(absolutePath);
  const extension = path.extname(fileName).toLowerCase();
  const imageMimeType = IMAGE_MIME_BY_EXTENSION[extension];

  if (imageMimeType) {
    if (fileStats.size > IMAGE_EMBED_MAX_BYTES) {
      return {
        id: crypto.randomUUID(),
        label: `Image: ${fileName} (${Math.round(fileStats.size / 1024)}KB, too large to embed)`,
        payload: `[Image attachment: ${fileName}] (${imageMimeType}, ${fileStats.size} bytes, too large to embed)`,
      };
    }

    const imageBuffer = await fs.readFile(absolutePath);
    return {
      id: crypto.randomUUID(),
      label: `Image: ${fileName}`,
      payload: `![${fileName}](data:${imageMimeType};base64,${imageBuffer.toString('base64')})`,
    };
  }

  const fileBuffer = await fs.readFile(absolutePath);
  if (
    fileStats.size <= TEXT_EMBED_MAX_BYTES &&
    isLikelyTextBuffer(fileBuffer)
  ) {
    const fileText = fileBuffer.toString('utf8');
    const truncatedText =
      fileText.length > TEXT_EMBED_MAX_CHARS
        ? `${fileText.slice(0, TEXT_EMBED_MAX_CHARS)}\n\n...[truncated ${fileText.length - TEXT_EMBED_MAX_CHARS} chars]`
        : fileText;
    const language = inferCodeFenceLanguage(fileName);
    return {
      id: crypto.randomUUID(),
      label: `File: ${fileName} (${truncatedText.length} chars)`,
      payload: `Attached file: ${fileName}\n\`\`\`${language}\n${truncatedText}\n\`\`\``,
    };
  }

  return {
    id: crypto.randomUUID(),
    label: `File: ${fileName} (${Math.round(fileStats.size / 1024)}KB binary)`,
    payload: `[File attachment: ${fileName}] (${fileStats.size} bytes, binary content omitted)`,
  };
};

export function InteractiveInput({
  question,
  questionId,
  predefinedOptions = [],
  onSubmit,
  onInputActivity,
  searchRoot,
}: InteractiveInputProps) {
  const [mode, setMode] = useState<'option' | 'input'>(
    predefinedOptions.length > 0 ? 'option' : 'input',
  );
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [inputValue, setInputValue] = useState<string>('');
  const [caretPosition, setCaretPosition] = useState<number>(0);
  const [repositoryFiles, setRepositoryFiles] = useState<string[]>([]);
  const [isIndexingFiles, setIsIndexingFiles] = useState(false);
  const [fileSuggestions, setFileSuggestions] = useState<string[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [textareaRenderVersion, setTextareaRenderVersion] = useState(0);
  const [focusRequestToken, setFocusRequestToken] = useState(0);
  const [clipboardStatus, setClipboardStatus] = useState<string | null>(null);
  const [queuedAttachments, setQueuedAttachments] = useState<
    QueuedAttachment[]
  >([]);

  const textareaRef = useRef<TextareaRenderableLike | null>(null);
  const latestInputValueRef = useRef(inputValue);
  const latestCaretPositionRef = useRef(caretPosition);
  const autocompleteTargetRef = useRef<AutocompleteTarget | null>(null);

  const { width, height } = useTerminalDimensions();
  const isNarrow = width < 90;
  const hasOptions = predefinedOptions.length > 0;
  const hasSearchRoot = Boolean(searchRoot);

  const activeAutocompleteTarget =
    mode === 'input' ? getAutocompleteTarget(inputValue, caretPosition) : null;

  const { rows: textareaRows, containerHeight: textareaContainerHeight } =
    useMemo(
      () =>
        getTextareaDimensions({
          value: inputValue,
          width,
          terminalHeight: height,
          isNarrow,
        }),
      [height, inputValue, isNarrow, width],
    );

  const textareaBaseKeyBindings = useMemo(
    () => textareaKeyBindings.filter((binding) => binding.action !== 'submit'),
    [],
  );

  const hasActiveSearchSuggestions =
    mode === 'input' &&
    activeAutocompleteTarget !== null &&
    fileSuggestions.length > 0;

  const textareaBindings = useMemo(() => {
    if (!hasActiveSearchSuggestions) {
      return textareaBaseKeyBindings;
    }

    return [
      ...textareaBaseKeyBindings,
      { name: 'enter', action: 'submit' as const },
      { name: 'return', action: 'submit' as const },
    ];
  }, [hasActiveSearchSuggestions, textareaBaseKeyBindings]);

  const selectedSuggestion = fileSuggestions[selectedSuggestionIndex];

  const selectedSuggestionVscodeLink = useMemo(() => {
    if (!searchRoot || !selectedSuggestion) {
      return null;
    }

    const absolutePath = path.resolve(searchRoot, selectedSuggestion);
    const normalizedPath = absolutePath.split(path.sep).join('/');
    const vscodePath = normalizedPath.startsWith('/')
      ? normalizedPath
      : `/${normalizedPath}`;

    return `vscode://file${encodeURI(vscodePath)}`;
  }, [searchRoot, selectedSuggestion]);

  const safeReadTextarea = useCallback(() => {
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
      textareaRef.current = null;
      return null;
    }
  }, []);

  const safeWriteTextarea = useCallback(
    (nextValue: string, nextCaretPosition: number) => {
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
        textareaRef.current = null;
        return false;
      }
    },
    [],
  );

  const focusTextarea = useCallback(() => {
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
      textareaRef.current = null;
      return false;
    }
  }, []);

  useEffect(() => {
    latestInputValueRef.current = inputValue;
  }, [inputValue]);

  useEffect(() => {
    latestCaretPositionRef.current = caretPosition;
  }, [caretPosition]);

  useEffect(() => {
    if (!clipboardStatus) {
      return;
    }

    const clearStatusTimeout = setTimeout(() => {
      setClipboardStatus(null);
    }, 2000);

    return () => {
      clearTimeout(clearStatusTimeout);
    };
  }, [clipboardStatus]);

  useEffect(() => {
    let active = true;
    const repositoryRoot = searchRoot;

    autocompleteTargetRef.current = null;
    setFileSuggestions([]);
    setSelectedSuggestionIndex(0);

    if (!repositoryRoot) {
      setRepositoryFiles([]);
      setIsIndexingFiles(false);
      return () => {
        active = false;
      };
    }

    const cachedFiles = repositoryFileCache.get(repositoryRoot);
    if (cachedFiles) {
      setRepositoryFiles(cachedFiles);
      setIsIndexingFiles(false);
      return () => {
        active = false;
      };
    }

    setRepositoryFiles([]);
    setIsIndexingFiles(true);

    void readRepositoryFiles(repositoryRoot)
      .then((files) => {
        if (!active) {
          return;
        }

        repositoryFileCache.set(repositoryRoot, files);
        setRepositoryFiles(files);
        setIsIndexingFiles(false);
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setRepositoryFiles([]);
        setIsIndexingFiles(false);
      });

    return () => {
      active = false;
    };
  }, [searchRoot]);

  useEffect(() => {
    setMode(predefinedOptions.length > 0 ? 'option' : 'input');
    setSelectedIndex(0);
    setInputValue('');
    setCaretPosition(0);
    setQueuedAttachments([]);
    latestInputValueRef.current = '';
    latestCaretPositionRef.current = 0;
    setFileSuggestions([]);
    setSelectedSuggestionIndex(0);

    safeWriteTextarea('', 0);
  }, [predefinedOptions.length, questionId, safeWriteTextarea]);

  useEffect(() => {
    if (mode !== 'input') {
      return;
    }

    const nextValue = latestInputValueRef.current;
    const clampedCaret = Math.max(
      0,
      Math.min(latestCaretPositionRef.current, nextValue.length),
    );

    const didWrite = safeWriteTextarea(nextValue, clampedCaret);
    if (!didWrite) {
      setTextareaRenderVersion((previous) => previous + 1);
      return;
    }

    if (!focusTextarea()) {
      setTextareaRenderVersion((previous) => previous + 1);
    }
  }, [
    focusRequestToken,
    focusTextarea,
    height,
    mode,
    questionId,
    safeWriteTextarea,
    textareaRenderVersion,
    width,
  ]);

  useEffect(() => {
    if (mode !== 'input' || repositoryFiles.length === 0) {
      autocompleteTargetRef.current = null;
      setFileSuggestions([]);
      setSelectedSuggestionIndex(0);
      return;
    }

    const target = getAutocompleteTarget(inputValue, caretPosition);
    autocompleteTargetRef.current = target;

    if (!target) {
      setFileSuggestions([]);
      setSelectedSuggestionIndex(0);
      return;
    }

    const nextSuggestions = rankFileSuggestions(repositoryFiles, target.query);
    setFileSuggestions(nextSuggestions);
    setSelectedSuggestionIndex((previous) =>
      nextSuggestions.length === 0
        ? 0
        : Math.min(previous, nextSuggestions.length - 1),
    );
  }, [caretPosition, inputValue, mode, repositoryFiles]);

  const syncInputStateFromTextarea = useCallback(() => {
    const textareaState = safeReadTextarea();
    if (!textareaState) {
      return;
    }

    const nextValue = textareaState.value;
    const nextCaret = textareaState.caret;
    const didChange =
      nextValue !== latestInputValueRef.current ||
      nextCaret !== latestCaretPositionRef.current;

    if (!didChange) {
      return;
    }

    latestInputValueRef.current = nextValue;
    latestCaretPositionRef.current = nextCaret;
    setInputValue(nextValue);
    setCaretPosition(nextCaret);
    onInputActivity?.();
  }, [onInputActivity, safeReadTextarea]);

  const setTextareaValue = useCallback(
    (nextValue: string, nextCaretPosition: number) => {
      const clampedCaret = Math.max(
        0,
        Math.min(nextCaretPosition, nextValue.length),
      );

      safeWriteTextarea(nextValue, clampedCaret);
      latestInputValueRef.current = nextValue;
      latestCaretPositionRef.current = clampedCaret;
      setInputValue(nextValue);
      setCaretPosition(clampedCaret);
      onInputActivity?.();
    },
    [onInputActivity, safeWriteTextarea],
  );

  const setModeToInput = useCallback(() => {
    setMode('input');
    onInputActivity?.();
  }, [onInputActivity]);

  const requestInputFocus = useCallback(
    (forceRemount = false) => {
      setMode('input');
      if (forceRemount) {
        setTextareaRenderVersion((previous) => previous + 1);
      }
      setFocusRequestToken((previous) => previous + 1);
      onInputActivity?.();
    },
    [onInputActivity],
  );

  const recoverInputFocusFromClick = useCallback(() => {
    requestInputFocus();
  }, [requestInputFocus]);

  const setModeToOption = useCallback(() => {
    if (predefinedOptions.length === 0) {
      return;
    }

    setMode('option');
    onInputActivity?.();
  }, [onInputActivity, predefinedOptions.length]);

  const copyInputToClipboard = useCallback(() => {
    if (mode !== 'input') {
      return;
    }

    const textarea = textareaRef.current;
    const selectedText =
      typeof textarea?.hasSelection === 'function' &&
      textarea.hasSelection() &&
      typeof textarea.getSelectedText === 'function'
        ? textarea.getSelectedText()
        : '';
    const fallbackText = textarea?.plainText ?? inputValue;
    const textToCopy = selectedText.length > 0 ? selectedText : fallbackText;

    if (textToCopy.length === 0) {
      setClipboardStatus('Nothing to copy');
      return;
    }

    void copyTextToClipboard(textToCopy)
      .then(() => {
        setClipboardStatus('Copied input to clipboard');
      })
      .catch((error: unknown) => {
        const errorMessage =
          error instanceof Error ? error.message : 'unknown error';
        setClipboardStatus(`Copy failed: ${errorMessage}`);
      });
    onInputActivity?.();
  }, [inputValue, mode, onInputActivity]);

  const insertTextAtCaret = useCallback(
    (text: string) => {
      if (!text) {
        return;
      }

      const textareaState = safeReadTextarea();
      const currentValue = textareaState?.value ?? inputValue;
      const currentCaret = Math.max(
        0,
        Math.min(textareaState?.caret ?? caretPosition, currentValue.length),
      );
      const nextValue =
        currentValue.slice(0, currentCaret) +
        text +
        currentValue.slice(currentCaret);
      setTextareaValue(nextValue, currentCaret + text.length);
    },
    [caretPosition, inputValue, safeReadTextarea, setTextareaValue],
  );

  const queueAttachment = useCallback((attachment: QueuedAttachment) => {
    setQueuedAttachments((previous) => [...previous, attachment]);
  }, []);

  const handlePastedText = useCallback(
    (pastedText: string) => {
      if (!pastedText) {
        return;
      }

      const pasteAsPlainText = () => {
        insertTextAtCaret(pastedText);
        setClipboardStatus('Pasted text');
        onInputActivity?.();
      };

      const normalizedPath = normalizeClipboardPath(pastedText, searchRoot);
      if (normalizedPath) {
        void buildAttachmentFromPath(normalizedPath)
          .then((attachment) => {
            queueAttachment(attachment);
            setClipboardStatus(`Queued ${attachment.label}`);
            onInputActivity?.();
          })
          .catch(() => {
            pasteAsPlainText();
          });
        return;
      }

      if (shouldCollapsePastedText(pastedText)) {
        queueAttachment({
          id: crypto.randomUUID(),
          label: `Pasted text block (${pastedText.length} chars)`,
          payload: pastedText,
        });
        setClipboardStatus('Queued pasted text block');
        onInputActivity?.();
        return;
      }

      pasteAsPlainText();
    },
    [insertTextAtCaret, onInputActivity, queueAttachment, searchRoot],
  );

  const pasteClipboardIntoInput = useCallback(() => {
    requestInputFocus();

    void readTextFromClipboard()
      .then(async (clipboardText) => {
        if (clipboardText.trim()) {
          handlePastedText(clipboardText);
          return;
        }

        const clipboardPaths = await readFilePathsFromClipboard();
        if (clipboardPaths.length > 0) {
          const attachments = await Promise.all(
            clipboardPaths.map(async (clipboardPath) => {
              try {
                return await buildAttachmentFromPath(clipboardPath);
              } catch {
                return null;
              }
            }),
          );
          const validAttachments = attachments.filter(
            (value): value is QueuedAttachment => value !== null,
          );
          if (validAttachments.length > 0) {
            validAttachments.forEach((attachment) => {
              queueAttachment(attachment);
            });
            setClipboardStatus(
              validAttachments.length === 1
                ? `Queued ${validAttachments[0].label}`
                : `Queued ${validAttachments.length} clipboard files`,
            );
            onInputActivity?.();
            return;
          }
        }

        const imageDataUrl = await readImageDataUrlFromClipboard();
        if (imageDataUrl) {
          queueAttachment({
            id: crypto.randomUUID(),
            label: 'Image: pasted-image.png',
            payload: `![pasted-image.png](${imageDataUrl})`,
          });
          setClipboardStatus('Queued clipboard image');
          onInputActivity?.();
          return;
        }

        setClipboardStatus('Paste failed: clipboard is empty');
      })
      .catch((error: unknown) => {
        const errorMessage =
          error instanceof Error ? error.message : 'unknown error';
        setClipboardStatus(`Paste failed: ${errorMessage}`);
      });
  }, [handlePastedText, onInputActivity, queueAttachment, requestInputFocus]);

  const submitCurrentSelection = useCallback(() => {
    const baseValue =
      mode === 'option' && predefinedOptions.length > 0
        ? predefinedOptions[selectedIndex]
        : (safeReadTextarea()?.value ?? inputValue);
    const attachmentPayload = queuedAttachments
      .map((attachment) => attachment.payload)
      .join('\n\n');
    const finalValue = attachmentPayload
      ? baseValue.trim().length > 0
        ? `${baseValue}\n\n${attachmentPayload}`
        : attachmentPayload
      : baseValue;

    onSubmit(questionId, finalValue);
    setQueuedAttachments([]);
  }, [
    inputValue,
    mode,
    onSubmit,
    predefinedOptions,
    queuedAttachments,
    questionId,
    safeReadTextarea,
    selectedIndex,
  ]);

  const applySelectedSuggestion = useCallback(
    (
      targetOverride?: AutocompleteTarget,
      suggestionsOverride?: string[],
      selectedIndexOverride?: number,
    ) => {
      const target = targetOverride ?? autocompleteTargetRef.current;
      const availableSuggestions = suggestionsOverride ?? fileSuggestions;

      if (!target || availableSuggestions.length === 0) {
        return;
      }

      const index = selectedIndexOverride ?? selectedSuggestionIndex;
      const suggestion = availableSuggestions[index] ?? availableSuggestions[0];
      const currentValue = safeReadTextarea()?.value ?? inputValue;
      const nextValue =
        currentValue.slice(0, target.start) +
        suggestion +
        currentValue.slice(target.end);
      const nextCaret = target.start + suggestion.length;

      setTextareaValue(nextValue, nextCaret);
    },
    [
      fileSuggestions,
      inputValue,
      safeReadTextarea,
      selectedSuggestionIndex,
      setTextareaValue,
    ],
  );

  const insertCharacterInTextarea = useCallback(
    (character: string) => {
      if (!character) {
        return;
      }

      const currentValue = safeReadTextarea()?.value ?? inputValue;
      const currentCaret = Math.max(
        0,
        Math.min(caretPosition, currentValue.length),
      );
      const nextValue =
        currentValue.slice(0, currentCaret) +
        character +
        currentValue.slice(currentCaret);

      setTextareaValue(nextValue, currentCaret + character.length);
    },
    [caretPosition, inputValue, safeReadTextarea, setTextareaValue],
  );

  const handleTextareaSubmit = useCallback(() => {
    const textareaState = safeReadTextarea();
    const currentValue = textareaState?.value ?? inputValue;
    const currentCaret = textareaState?.caret ?? caretPosition;
    const currentTarget =
      mode === 'input'
        ? getAutocompleteTarget(currentValue, currentCaret)
        : null;

    if (currentTarget && repositoryFiles.length > 0) {
      const nextSuggestions = rankFileSuggestions(
        repositoryFiles,
        currentTarget.query,
      );

      if (nextSuggestions.length > 0) {
        autocompleteTargetRef.current = currentTarget;
        const clampedSelectedSuggestionIndex = Math.min(
          selectedSuggestionIndex,
          nextSuggestions.length - 1,
        );

        setFileSuggestions(nextSuggestions);
        setSelectedSuggestionIndex(clampedSelectedSuggestionIndex);
        applySelectedSuggestion(
          currentTarget,
          nextSuggestions,
          clampedSelectedSuggestionIndex,
        );
        return;
      }
    }

    insertCharacterInTextarea('\n');
  }, [
    applySelectedSuggestion,
    caretPosition,
    inputValue,
    insertCharacterInTextarea,
    mode,
    repositoryFiles,
    safeReadTextarea,
    selectedSuggestionIndex,
  ]);

  useKeyboard((key) => {
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

    if (hasOptions && (isReverseTabShortcut(key) || key.name === 'tab')) {
      if (mode === 'option') {
        setModeToInput();
      } else {
        setModeToOption();
      }
      return;
    }

    if (mode === 'option' && hasOptions) {
      const isOptionSubmitKey =
        key.name === 'enter' ||
        key.name === 'return' ||
        key.sequence === '\r' ||
        key.sequence === '\n';

      if (isOptionSubmitKey) {
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

    if (mode !== 'input' || fileSuggestions.length === 0) {
      return;
    }

    if (key.name === 'tab') {
      applySelectedSuggestion();
      return;
    }

    if ((key.ctrl || key.meta) && key.name.toLowerCase() === 'n') {
      setSelectedSuggestionIndex(
        (previous) => (previous + 1) % fileSuggestions.length,
      );
      onInputActivity?.();
      return;
    }

    if ((key.ctrl || key.meta) && key.name.toLowerCase() === 'p') {
      setSelectedSuggestionIndex((previous) =>
        previous <= 0 ? fileSuggestions.length - 1 : previous - 1,
      );
      onInputActivity?.();
      return;
    }

    if (key.name === 'down') {
      setSelectedSuggestionIndex(
        (previous) => (previous + 1) % fileSuggestions.length,
      );
      onInputActivity?.();
      return;
    }

    if (key.name === 'up') {
      setSelectedSuggestionIndex((previous) =>
        previous <= 0 ? fileSuggestions.length - 1 : previous - 1,
      );
      onInputActivity?.();
    }
  });

  return (
    <>
      <box
        flexDirection="column"
        marginBottom={0}
        width="100%"
        gap={0}
        border
        borderStyle="single"
        borderColor="cyan"
        backgroundColor="#121212"
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
      >
        <text fg="cyan">
          <strong>PROMPT</strong>
        </text>
        <MarkdownText content={question} showCodeCopyControls />
      </box>

      <ModeTabs
        mode={mode}
        hasOptions={hasOptions}
        onSelectOptionMode={setModeToOption}
        onSelectInputMode={recoverInputFocusFromClick}
      />

      <OptionList
        mode={mode}
        options={predefinedOptions}
        selectedIndex={selectedIndex}
        onSelectOption={setSelectedIndex}
        onActivateOptionMode={setModeToOption}
      />

      {mode === 'input' && (
        <InputEditor
          questionId={questionId}
          textareaRenderVersion={textareaRenderVersion}
          textareaRef={textareaRef}
          textareaContainerHeight={textareaContainerHeight}
          textareaRows={textareaRows}
          hasSuggestions={fileSuggestions.length > 0}
          keyBindings={textareaBindings as Array<Record<string, unknown>>}
          onFocusRequest={recoverInputFocusFromClick}
          onContentSync={syncInputStateFromTextarea}
          onSubmitFromTextarea={handleTextareaSubmit}
        />
      )}

      {mode === 'input' && activeAutocompleteTarget !== null && (
        <SuggestionsPanel
          hasOptions={hasOptions}
          isIndexingFiles={isIndexingFiles}
          fileSuggestions={fileSuggestions}
          selectedSuggestionIndex={selectedSuggestionIndex}
          selectedSuggestionVscodeLink={selectedSuggestionVscodeLink}
          hasSearchRoot={hasSearchRoot}
        />
      )}

      {mode === 'input' && (
        <box flexDirection="column" marginBottom={0} width="100%">
          <text fg="gray" wrapMode="char">
            {hasSearchRoot
              ? `#search root: ${searchRoot}`
              : '#search root: no search root'}
          </text>
          <text fg="gray">
            {isIndexingFiles
              ? '#search index: indexing...'
              : `#search index: ${repositoryFiles.length} files indexed`}
          </text>
        </box>
      )}

      <box
        flexDirection={isNarrow ? 'column' : 'row'}
        justifyContent="space-between"
        marginBottom={0}
        gap={isNarrow ? 0 : undefined}
      >
        <text fg="gray">
          {mode === 'input' ? 'Custom input' : 'Option selection'}
        </text>
        <text fg="gray">
          {mode === 'input' && queuedAttachments.length > 0
            ? `${inputValue.length} chars + ${queuedAttachments.length} queued`
            : `${inputValue.length} chars`}
        </text>
      </box>

      {mode === 'input' && clipboardStatus && (
        <text fg={clipboardStatus.startsWith('Copy failed:') ? 'red' : 'green'}>
          {clipboardStatus}
        </text>
      )}

      {mode === 'input' && queuedAttachments.length > 0 && (
        <box flexDirection="column" width="100%">
          <text fg="yellow">
            <strong>QUEUED ATTACHMENTS</strong>
          </text>
          {queuedAttachments.map((attachment) => (
            <text key={attachment.id} fg="gray" wrapMode="word">
              - {attachment.label}
            </text>
          ))}
        </box>
      )}

      {mode === 'input' && (
        <box
          backgroundColor="cyan"
          paddingLeft={1}
          paddingRight={1}
          alignSelf="flex-start"
          marginBottom={0}
          onClick={submitCurrentSelection}
        >
          <text fg="black">
            <strong>Send</strong> ⌃S
          </text>
        </box>
      )}

      {mode === 'input' && (
        <text fg="gray" wrapMode="word">
          {hasOptions
            ? 'Enter/Ctrl+J newline (or #search apply) • #search nav: ↑/↓ or Ctrl+N/P • Tab mode switch • #path for repo file autocomplete • Cmd/Ctrl+C copy • Cmd/Ctrl+V paste/attach'
            : 'Enter/Ctrl+J newline • #search nav: ↑/↓ or Ctrl+N/P • Enter/Tab #search apply • #path for repo file autocomplete • Cmd/Ctrl+C copy • Cmd/Ctrl+V paste/attach'}
        </text>
      )}
    </>
  );
}
