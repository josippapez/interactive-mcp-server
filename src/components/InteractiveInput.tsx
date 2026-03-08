import * as OpenTuiReact from '@opentui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getAutocompleteTarget,
  rankFileSuggestions,
  readRepositoryFiles,
} from './interactive-input/autocomplete.js';
import {
  isPrintableCharacter,
  isReverseTabShortcut,
  isSubmitShortcut,
  textareaKeyBindings,
} from './interactive-input/keyboard.js';
import type {
  AutocompleteTarget,
  InteractiveInputProps,
  OpenTuiKeyEvent,
  TextareaRenderableLike,
} from './interactive-input/types.js';
import { MarkdownText } from './MarkdownText.js';

const { useKeyboard } = OpenTuiReact as unknown as {
  useKeyboard: (handler: (key: OpenTuiKeyEvent) => void) => void;
};
const { useTerminalDimensions } = OpenTuiReact as unknown as {
  useTerminalDimensions: () => { width: number; height: number };
};
const repositoryFileCache = new Map<string, string[]>();

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
  const textareaRef = useRef<TextareaRenderableLike | null>(null);
  const latestInputValueRef = useRef(inputValue);
  const latestCaretPositionRef = useRef(caretPosition);
  const autocompleteTargetRef = useRef<AutocompleteTarget | null>(null);
  const { width, height } = useTerminalDimensions();
  const isNarrow = width < 90;
  const activeAutocompleteTarget =
    mode === 'input' ? getAutocompleteTarget(inputValue, caretPosition) : null;
  const hasSearchRoot = Boolean(searchRoot);
  const textareaBaseKeyBindings = useMemo(
    () => textareaKeyBindings.filter((binding) => binding.action !== 'submit'),
    [],
  );

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
      setTextareaRenderVersion((prev) => prev + 1);
      return;
    }

    if (!focusTextarea()) {
      setTextareaRenderVersion((prev) => prev + 1);
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
    setSelectedSuggestionIndex((prev) =>
      nextSuggestions.length === 0
        ? 0
        : Math.min(prev, nextSuggestions.length - 1),
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
        setTextareaRenderVersion((prev) => prev + 1);
      }
      setFocusRequestToken((prev) => prev + 1);
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

  const submitCurrentSelection = useCallback(() => {
    if (mode === 'option' && predefinedOptions.length > 0) {
      onSubmit(questionId, predefinedOptions[selectedIndex]);
      return;
    }

    const textareaValue = safeReadTextarea()?.value ?? inputValue;
    onSubmit(questionId, textareaValue);
  }, [
    inputValue,
    mode,
    onSubmit,
    predefinedOptions,
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
      const selectedSuggestion =
        availableSuggestions[index] ?? availableSuggestions[0];

      const currentValue = safeReadTextarea()?.value ?? inputValue;
      const nextValue =
        currentValue.slice(0, target.start) +
        selectedSuggestion +
        currentValue.slice(target.end);
      const nextCaret = target.start + selectedSuggestion.length;

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

    if (
      predefinedOptions.length > 0 &&
      (isReverseTabShortcut(key) || key.name === 'tab')
    ) {
      if (mode === 'option') {
        setModeToInput();
      } else {
        setModeToOption();
      }
      return;
    }

    if (mode === 'option' && predefinedOptions.length > 0) {
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

      if (key.name === 'up') {
        setSelectedIndex(
          (prev) =>
            (prev - 1 + predefinedOptions.length) % predefinedOptions.length,
        );
        onInputActivity?.();
        return;
      }

      if (key.name.toLowerCase() === 'k') {
        setSelectedIndex(
          (prev) =>
            (prev - 1 + predefinedOptions.length) % predefinedOptions.length,
        );
        onInputActivity?.();
        return;
      }

      if (key.name === 'down') {
        setSelectedIndex((prev) => (prev + 1) % predefinedOptions.length);
        onInputActivity?.();
        return;
      }

      if (key.name.toLowerCase() === 'j') {
        setSelectedIndex((prev) => (prev + 1) % predefinedOptions.length);
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
      setSelectedSuggestionIndex((prev) => (prev + 1) % fileSuggestions.length);
      onInputActivity?.();
      return;
    }

    if ((key.ctrl || key.meta) && key.name.toLowerCase() === 'p') {
      setSelectedSuggestionIndex((prev) =>
        prev <= 0 ? fileSuggestions.length - 1 : prev - 1,
      );
      onInputActivity?.();
      return;
    }

    if (key.name === 'down') {
      setSelectedSuggestionIndex((prev) => (prev + 1) % fileSuggestions.length);
      onInputActivity?.();
      return;
    }

    if (key.name === 'up') {
      setSelectedSuggestionIndex((prev) =>
        prev <= 0 ? fileSuggestions.length - 1 : prev - 1,
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
      >
        <text fg="cyan">
          <strong>PROMPT</strong>
        </text>
        <MarkdownText content={question} showCodeCopyControls />
      </box>

      <box flexDirection="column" marginBottom={0} width="100%" gap={0}>
        <text fg="gray">Mode</text>
        <box
          flexDirection="row"
          alignSelf="flex-start"
          border
          borderStyle="single"
          borderColor="orange"
          backgroundColor="#151515"
          paddingLeft={0}
          paddingRight={0}
        >
          {predefinedOptions.length > 0 && (
            <box
              justifyContent="center"
              paddingLeft={0}
              paddingRight={0}
              onClick={setModeToOption}
              backgroundColor={mode === 'option' ? 'orange' : '#151515'}
            >
              <text fg={mode === 'option' ? 'black' : 'gray'}>
                {mode === 'option' ? 'Option' : 'option'}
              </text>
            </box>
          )}
          {predefinedOptions.length > 0 && <text fg="#3a3a3a">│</text>}
          <box
            justifyContent="center"
            paddingLeft={0}
            paddingRight={0}
            onClick={recoverInputFocusFromClick}
            backgroundColor={mode === 'input' ? 'orange' : '#151515'}
          >
            <text fg={mode === 'input' ? 'black' : 'gray'}>
              {mode === 'input' ? 'Input' : 'input'}
            </text>
          </box>
        </box>
      </box>

      {predefinedOptions.length > 0 && (
        <box flexDirection="column" marginBottom={1} width="100%" gap={1}>
          <text fg="gray" wrapMode="word">
            Option mode: ↑/↓ or j/k choose • Enter select • Tab switch mode
          </text>
          <box flexDirection="column" width="100%" gap={1}>
            {predefinedOptions.map((opt, i) => (
              <box
                key={`${opt}-${i}`}
                width="100%"
                paddingLeft={0}
                paddingRight={1}
                onClick={() => {
                  setSelectedIndex(i);
                  setModeToOption();
                }}
              >
                <text
                  wrapMode="char"
                  fg={
                    i === selectedIndex && mode === 'option' ? 'cyan' : 'gray'
                  }
                >
                  {i === selectedIndex && mode === 'option' ? '› ' : '  '}
                  {opt}
                </text>
              </box>
            ))}
          </box>
        </box>
      )}

      {mode === 'input' && (
        <box flexDirection="column" marginBottom={0} width="100%">
          <text fg="gray">Input</text>
          <box
            border
            borderStyle="single"
            borderColor={fileSuggestions.length > 0 ? 'cyan' : 'gray'}
            backgroundColor="#1f1f1f"
            width="100%"
            height={isNarrow ? 4 : 6}
            paddingLeft={0}
            paddingRight={0}
            onClick={recoverInputFocusFromClick}
          >
            <textarea
              ref={textareaRef}
              key={`textarea-${questionId}-${textareaRenderVersion}`}
              focused
              wrapMode="word"
              backgroundColor="#1f1f1f"
              focusedBackgroundColor="#1f1f1f"
              textColor="white"
              focusedTextColor="white"
              placeholderColor="gray"
              placeholder="Type your answer..."
              keyBindings={textareaBindings}
              onContentChange={syncInputStateFromTextarea}
              onCursorChange={syncInputStateFromTextarea}
              onSubmit={handleTextareaSubmit}
            />
          </box>
        </box>
      )}

      {mode === 'input' && activeAutocompleteTarget !== null && (
        <box flexDirection="column" marginBottom={1} width="100%" gap={0}>
          <text fg="gray">
            {predefinedOptions.length > 0
              ? 'File suggestions • ↑/↓ or Ctrl+N/P navigate • Enter apply'
              : 'File suggestions • ↑/↓ or Ctrl+N/P navigate • Enter/Tab apply'}
          </text>
          {isIndexingFiles ? (
            <text fg="gray">Indexing files...</text>
          ) : fileSuggestions.length > 0 ? (
            <box flexDirection="column" width="100%">
              {fileSuggestions.map((suggestion, index) => (
                <box key={suggestion} paddingLeft={0} paddingRight={1}>
                  <text
                    fg={index === selectedSuggestionIndex ? 'cyan' : 'gray'}
                    wrapMode="char"
                  >
                    {index === selectedSuggestionIndex ? '› ' : '  '}
                    {suggestion}
                  </text>
                </box>
              ))}
            </box>
          ) : (
            <text fg="gray">
              {hasSearchRoot
                ? '#search: no matches'
                : '#search: no search root configured'}
            </text>
          )}
        </box>
      )}

      {mode === 'input' && (
        <box flexDirection="column" marginBottom={1} width="100%">
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
        marginBottom={1}
        gap={isNarrow ? 0 : undefined}
      >
        <text fg="gray">
          {mode === 'input' ? 'Custom input' : 'Option selection'}
        </text>
        <text fg="gray">{inputValue.length} chars</text>
      </box>

      {mode === 'input' && (
        <box
          backgroundColor="cyan"
          paddingLeft={1}
          paddingRight={1}
          alignSelf="flex-start"
          marginBottom={1}
          onClick={submitCurrentSelection}
        >
          <text fg="black">
            <strong>Send</strong> ⌃S
          </text>
        </box>
      )}

      {mode === 'input' && (
        <text fg="gray" wrapMode="word">
          {predefinedOptions.length > 0
            ? 'Enter/Ctrl+J newline (or #search apply) • #search nav: ↑/↓ or Ctrl+N/P • Tab mode switch • #path for repo file autocomplete'
            : 'Enter/Ctrl+J newline • #search nav: ↑/↓ or Ctrl+N/P • Enter/Tab #search apply • #path for repo file autocomplete'}
        </text>
      )}
    </>
  );
}
