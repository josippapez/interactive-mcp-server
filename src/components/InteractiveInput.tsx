import * as OpenTuiReact from '@opentui/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from 'react';
import path from 'node:path';
import {
  getAutocompleteTarget,
  rankFileSuggestions,
  readRepositoryFiles,
} from './interactive-input/autocomplete.js';
import { textareaKeyBindings } from './interactive-input/keyboard.js';
import {
  InputEditor,
  ModeTabs,
  OptionList,
  SuggestionsPanel,
  QuestionBox,
  SearchStatus,
  InputStatus,
  ClipboardStatus,
  AttachmentsDisplay,
  SendButton,
  HelpText,
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
  repositoryFileCache,
  type QueuedAttachment,
} from './interactive-input/constants.js';
import { createClipboardHandlers } from './interactive-input/clipboard-handlers.js';
import {
  safeReadTextarea,
  safeWriteTextarea,
  focusTextarea,
} from './interactive-input/textarea-operations.js';
import { createSubmitHandler } from './interactive-input/submit-handler.js';
import { createKeyboardRouter } from './interactive-input/keyboard-router.js';
import { resolveSuggestionSelection } from './interactive-input/suggestion-selection.js';
import {
  applyTextareaHighlights,
  createTextareaSyntaxHighlighting,
} from './interactive-input/textarea-highlighting.js';

const { useKeyboard } = OpenTuiReact as unknown as {
  useKeyboard: (handler: (key: OpenTuiKeyEvent) => void) => void;
};

const { useTerminalDimensions } = OpenTuiReact as unknown as {
  useTerminalDimensions: () => { width: number; height: number };
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
  const suggestionsScrollRef = useRef<{
    scrollTo?: (position: number | { x: number; y: number }) => void;
  } | null>(null);
  const latestInputValueRef = useRef(inputValue);
  const latestCaretPositionRef = useRef(caretPosition);
  const autocompleteTargetRef = useRef<AutocompleteTarget | null>(null);
  const selectedSuggestionIndexRef = useRef(0);

  const updateSelectedSuggestionIndex = useCallback(
    (nextValue: SetStateAction<number>) => {
      setSelectedSuggestionIndex((previous) => {
        const resolvedValue =
          typeof nextValue === 'function' ? nextValue(previous) : nextValue;
        selectedSuggestionIndexRef.current = resolvedValue;
        return resolvedValue;
      });
    },
    [],
  );

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
  const textareaSyntaxHighlighting = useMemo(
    () => createTextareaSyntaxHighlighting(),
    [],
  );

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

  // Detect when placeholders are manually removed from input
  const previousInputValueRef = useRef<string>('');
  useEffect(() => {
    if (queuedAttachments.length === 0) {
      previousInputValueRef.current = inputValue;
      return;
    }

    // Only check if input actually changed
    if (inputValue === previousInputValueRef.current) {
      return;
    }
    previousInputValueRef.current = inputValue;

    const currentText = inputValue;
    const missingAttachmentIds: string[] = [];

    queuedAttachments.forEach((attachment, index) => {
      const placeholder = `[Attached file ${index + 1}]`;
      if (!currentText.includes(placeholder)) {
        missingAttachmentIds.push(attachment.id);
      }
    });

    if (missingAttachmentIds.length > 0) {
      setQueuedAttachments((prev) =>
        prev.filter((a) => !missingAttachmentIds.includes(a.id)),
      );
    }
  }, [inputValue, queuedAttachments.length]);

  useEffect(() => {
    let active = true;
    const repositoryRoot = searchRoot;

    autocompleteTargetRef.current = null;
    setFileSuggestions([]);
    updateSelectedSuggestionIndex(0);

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
  }, [searchRoot, updateSelectedSuggestionIndex]);

  useEffect(() => {
    setMode(predefinedOptions.length > 0 ? 'option' : 'input');
    setSelectedIndex(0);
    setInputValue('');
    setCaretPosition(0);
    setQueuedAttachments([]);
    latestInputValueRef.current = '';
    latestCaretPositionRef.current = 0;
    setFileSuggestions([]);
    updateSelectedSuggestionIndex(0);

    safeWriteTextarea(textareaRef, '', 0);
  }, [predefinedOptions.length, questionId, updateSelectedSuggestionIndex]);

  useEffect(() => {
    if (mode !== 'input') {
      return;
    }

    const nextValue = latestInputValueRef.current;
    const clampedCaret = Math.max(
      0,
      Math.min(latestCaretPositionRef.current, nextValue.length),
    );

    const didWrite = safeWriteTextarea(textareaRef, nextValue, clampedCaret);
    if (!didWrite) {
      setTextareaRenderVersion((previous) => previous + 1);
      return;
    }

    applyTextareaHighlights({
      textarea: textareaRef.current,
      value: nextValue,
      styleIds: textareaSyntaxHighlighting?.styleIds,
    });

    if (!focusTextarea(textareaRef)) {
      setTextareaRenderVersion((previous) => previous + 1);
    }
  }, [
    focusRequestToken,
    height,
    mode,
    questionId,
    textareaRenderVersion,
    textareaSyntaxHighlighting?.styleIds,
    width,
  ]);

  useEffect(() => {
    if (fileSuggestions.length === 0) {
      return;
    }

    suggestionsScrollRef.current?.scrollTo?.({
      x: 0,
      y: selectedSuggestionIndex,
    });
    focusTextarea(textareaRef);
  }, [fileSuggestions.length, selectedSuggestionIndex]);

  useEffect(() => {
    if (mode !== 'input' || repositoryFiles.length === 0) {
      autocompleteTargetRef.current = null;
      setFileSuggestions([]);
      updateSelectedSuggestionIndex(0);
      return;
    }

    const target = getAutocompleteTarget(inputValue, caretPosition);
    autocompleteTargetRef.current = target;

    if (!target) {
      setFileSuggestions([]);
      updateSelectedSuggestionIndex(0);
      return;
    }

    const nextSuggestions = rankFileSuggestions(repositoryFiles, target.query);
    setFileSuggestions(nextSuggestions);
    updateSelectedSuggestionIndex((previous) =>
      nextSuggestions.length === 0
        ? 0
        : Math.min(previous, nextSuggestions.length - 1),
    );
  }, [
    caretPosition,
    inputValue,
    mode,
    repositoryFiles,
    updateSelectedSuggestionIndex,
  ]);

  const syncInputStateFromTextarea = useCallback(() => {
    const textareaState = safeReadTextarea(textareaRef);
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
    applyTextareaHighlights({
      textarea: textareaRef.current,
      value: nextValue,
      styleIds: textareaSyntaxHighlighting?.styleIds,
    });
    setInputValue(nextValue);
    setCaretPosition(nextCaret);
    onInputActivity?.();
  }, [onInputActivity, textareaSyntaxHighlighting?.styleIds]);

  const setTextareaValue = useCallback(
    (nextValue: string, nextCaretPosition: number) => {
      const clampedCaret = Math.max(
        0,
        Math.min(nextCaretPosition, nextValue.length),
      );

      safeWriteTextarea(textareaRef, nextValue, clampedCaret);
      applyTextareaHighlights({
        textarea: textareaRef.current,
        value: nextValue,
        styleIds: textareaSyntaxHighlighting?.styleIds,
      });
      latestInputValueRef.current = nextValue;
      latestCaretPositionRef.current = clampedCaret;
      setInputValue(nextValue);
      setCaretPosition(clampedCaret);
      onInputActivity?.();
    },
    [onInputActivity, textareaSyntaxHighlighting?.styleIds],
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
    requestInputFocus(false);
  }, [requestInputFocus]);

  const setModeToOption = useCallback(() => {
    if (predefinedOptions.length === 0) {
      return;
    }

    setMode('option');
    onInputActivity?.();
  }, [onInputActivity, predefinedOptions.length]);

  const insertTextAtCaret = useCallback(
    (text: string) => {
      if (!text) {
        return;
      }

      const textareaState = safeReadTextarea(textareaRef);
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
    [caretPosition, inputValue, setTextareaValue],
  );

  const queueAttachment = useCallback(
    (attachment: QueuedAttachment) => {
      setQueuedAttachments((previous) => {
        const nextAttachments = [...previous, attachment];
        const attachmentIndex = nextAttachments.length;
        const placeholderText = `[Attached file ${attachmentIndex}]`;

        // Insert placeholder at current caret position
        insertTextAtCaret(placeholderText);

        return nextAttachments;
      });
    },
    [insertTextAtCaret],
  );

  const clipboardHandlers = useMemo(
    () =>
      createClipboardHandlers({
        insertTextAtCaret,
        queueAttachment,
        setClipboardStatus,
        onInputActivity,
        searchRoot,
        requestInputFocus,
        textareaRef,
        inputValue,
        mode,
      }),
    [
      insertTextAtCaret,
      queueAttachment,
      onInputActivity,
      searchRoot,
      requestInputFocus,
      inputValue,
      mode,
    ],
  );

  const { copyInputToClipboard, handlePastedText, pasteClipboardIntoInput } =
    clipboardHandlers;

  const submitCurrentSelection = useMemo(
    () =>
      createSubmitHandler({
        mode,
        predefinedOptions,
        selectedIndex,
        inputValue,
        queuedAttachments,
        textareaRef,
        onSubmit,
        questionId,
        setQueuedAttachments,
      }),
    [
      mode,
      predefinedOptions,
      selectedIndex,
      inputValue,
      queuedAttachments,
      onSubmit,
      questionId,
    ],
  );

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

      const resolvedSelection = resolveSuggestionSelection({
        suggestions: availableSuggestions,
        selectedSuggestionIndex:
          selectedIndexOverride ?? selectedSuggestionIndex,
        latestHighlightedSuggestionIndex: selectedSuggestionIndexRef.current,
      });
      if (!resolvedSelection) {
        return;
      }
      const { index: resolvedIndex, suggestion } = resolvedSelection;
      updateSelectedSuggestionIndex(resolvedIndex);
      const currentValue = safeReadTextarea(textareaRef)?.value ?? inputValue;
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
      selectedSuggestionIndex,
      setTextareaValue,
      updateSelectedSuggestionIndex,
    ],
  );

  const insertCharacterInTextarea = useCallback(
    (character: string) => {
      if (!character) {
        return;
      }

      const currentValue = safeReadTextarea(textareaRef)?.value ?? inputValue;
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
    [caretPosition, inputValue, setTextareaValue],
  );

  const handleTextareaSubmit = useCallback(() => {
    const textareaState = safeReadTextarea(textareaRef);
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
        const resolvedSelection = resolveSuggestionSelection({
          suggestions: nextSuggestions,
          selectedSuggestionIndex,
          latestHighlightedSuggestionIndex: selectedSuggestionIndexRef.current,
        });
        const nextSelectedSuggestionIndex = resolvedSelection?.index ?? 0;

        setFileSuggestions(nextSuggestions);
        updateSelectedSuggestionIndex(nextSelectedSuggestionIndex);
        applySelectedSuggestion(
          currentTarget,
          nextSuggestions,
          nextSelectedSuggestionIndex,
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
    selectedSuggestionIndex,
    updateSelectedSuggestionIndex,
  ]);

  const keyboardHandler = useMemo(
    () =>
      createKeyboardRouter({
        mode,
        hasOptions,
        predefinedOptions,
        selectedIndex,
        setSelectedIndex,
        fileSuggestions,
        selectedSuggestionIndex,
        setSelectedSuggestionIndex: updateSelectedSuggestionIndex,
        setModeToInput,
        setModeToOption,
        submitCurrentSelection,
        applySelectedSuggestion,
        insertCharacterInTextarea,
        handlePastedText,
        pasteClipboardIntoInput,
        copyInputToClipboard,
        onInputActivity,
      }),
    [
      mode,
      hasOptions,
      predefinedOptions,
      selectedIndex,
      fileSuggestions,
      selectedSuggestionIndex,
      updateSelectedSuggestionIndex,
      setModeToInput,
      setModeToOption,
      submitCurrentSelection,
      applySelectedSuggestion,
      insertCharacterInTextarea,
      handlePastedText,
      pasteClipboardIntoInput,
      copyInputToClipboard,
      onInputActivity,
    ],
  );

  useKeyboard(keyboardHandler);

  return (
    <>
      <QuestionBox question={question} MarkdownTextComponent={MarkdownText} />

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
          textareaSyntaxStyle={textareaSyntaxHighlighting?.syntaxStyle}
          textareaContainerHeight={textareaContainerHeight}
          textareaRows={textareaRows}
          hasSuggestions={fileSuggestions.length > 0}
          keyBindings={textareaBindings as Array<Record<string, unknown>>}
          onFocusRequest={recoverInputFocusFromClick}
          onContentSync={syncInputStateFromTextarea}
          onSubmitFromTextarea={handleTextareaSubmit}
          focused
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
          scrollRef={suggestionsScrollRef}
        />
      )}

      {mode === 'input' && (
        <SearchStatus
          isIndexingFiles={isIndexingFiles}
          repositoryFiles={repositoryFiles}
          searchRoot={searchRoot}
          hasSearchRoot={hasSearchRoot}
        />
      )}

      <InputStatus
        mode={mode}
        isNarrow={isNarrow}
        inputValue={inputValue}
        queuedAttachments={queuedAttachments}
      />

      {mode === 'input' && clipboardStatus && (
        <ClipboardStatus status={clipboardStatus} />
      )}

      {mode === 'input' && queuedAttachments.length > 0 && (
        <AttachmentsDisplay queuedAttachments={queuedAttachments} />
      )}

      {mode === 'input' && <SendButton />}

      {mode === 'input' && <HelpText hasOptions={hasOptions} />}
    </>
  );
}
