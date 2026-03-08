import type { TextareaRenderableLike } from './types.js';
import { openExternalLink } from '@/utils/open-external-link.js';

interface ModeTabsProps {
  mode: 'option' | 'input';
  hasOptions: boolean;
  onSelectOptionMode: () => void;
  onSelectInputMode: () => void;
}

export const ModeTabs = ({
  mode,
  hasOptions,
  onSelectOptionMode,
  onSelectInputMode,
}: ModeTabsProps) => (
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
      {hasOptions && (
        <box
          justifyContent="center"
          paddingLeft={0}
          paddingRight={0}
          onClick={onSelectOptionMode}
          backgroundColor={mode === 'option' ? 'orange' : '#151515'}
        >
          <text fg={mode === 'option' ? 'black' : 'gray'}>
            {mode === 'option' ? 'Option' : 'option'}
          </text>
        </box>
      )}
      {hasOptions && <text fg="#3a3a3a">│</text>}
      <box
        justifyContent="center"
        paddingLeft={0}
        paddingRight={0}
        onClick={onSelectInputMode}
        backgroundColor={mode === 'input' ? 'orange' : '#151515'}
      >
        <text fg={mode === 'input' ? 'black' : 'gray'}>
          {mode === 'input' ? 'Input' : 'input'}
        </text>
      </box>
    </box>
  </box>
);

interface OptionListProps {
  mode: 'option' | 'input';
  options: string[];
  selectedIndex: number;
  onSelectOption: (index: number) => void;
  onActivateOptionMode: () => void;
}

export const OptionList = ({
  mode,
  options,
  selectedIndex,
  onSelectOption,
  onActivateOptionMode,
}: OptionListProps) => {
  if (options.length === 0) {
    return null;
  }

  return (
    <box flexDirection="column" marginBottom={1} width="100%" gap={1}>
      <text fg="gray" wrapMode="word">
        Option mode: ↑/↓ or j/k choose • Enter select • Tab switch mode
      </text>
      <box flexDirection="column" width="100%" gap={1}>
        {options.map((opt, index) => (
          <box
            key={`${opt}-${index}`}
            width="100%"
            paddingLeft={0}
            paddingRight={1}
            onClick={() => {
              onSelectOption(index);
              onActivateOptionMode();
            }}
          >
            <text
              wrapMode="char"
              fg={
                index === selectedIndex && mode === 'option' ? 'cyan' : 'gray'
              }
            >
              {index === selectedIndex && mode === 'option' ? '› ' : '  '}
              {opt}
            </text>
          </box>
        ))}
      </box>
    </box>
  );
};

interface InputEditorProps {
  questionId: string;
  textareaRenderVersion: number;
  textareaRef: { current: TextareaRenderableLike | null };
  textareaContainerHeight: number;
  textareaRows: number;
  hasSuggestions: boolean;
  keyBindings: Array<Record<string, unknown>>;
  onFocusRequest: () => void;
  onContentSync: () => void;
  onSubmitFromTextarea: () => void;
}

export const InputEditor = ({
  questionId,
  textareaRenderVersion,
  textareaRef,
  textareaContainerHeight,
  textareaRows,
  hasSuggestions,
  keyBindings,
  onFocusRequest,
  onContentSync,
  onSubmitFromTextarea,
}: InputEditorProps) => (
  <box flexDirection="column" marginBottom={0} width="100%">
    <text fg="gray">Input</text>
    <box
      border
      borderStyle="single"
      borderColor={hasSuggestions ? 'cyan' : 'gray'}
      backgroundColor="#1f1f1f"
      width="100%"
      height={textareaContainerHeight}
      paddingLeft={0}
      paddingRight={0}
      onClick={onFocusRequest}
    >
      <textarea
        ref={textareaRef}
        key={`textarea-${questionId}-${textareaRenderVersion}`}
        focused
        height={textareaRows}
        wrapMode="word"
        backgroundColor="#1f1f1f"
        focusedBackgroundColor="#1f1f1f"
        textColor="white"
        focusedTextColor="white"
        placeholderColor="gray"
        placeholder="Type your answer..."
        keyBindings={keyBindings}
        onContentChange={onContentSync}
        onCursorChange={onContentSync}
        onSubmit={onSubmitFromTextarea}
      />
    </box>
  </box>
);

interface SuggestionsPanelProps {
  hasOptions: boolean;
  isIndexingFiles: boolean;
  fileSuggestions: string[];
  selectedSuggestionIndex: number;
  selectedSuggestionVscodeLink: string | null;
  hasSearchRoot: boolean;
}

export const SuggestionsPanel = ({
  hasOptions,
  isIndexingFiles,
  fileSuggestions,
  selectedSuggestionIndex,
  selectedSuggestionVscodeLink,
  hasSearchRoot,
}: SuggestionsPanelProps) => (
  <box flexDirection="column" marginBottom={1} width="100%" gap={0}>
    <text fg="gray">
      {hasOptions
        ? 'File suggestions • ↑/↓ or Ctrl+N/P navigate • Enter apply'
        : 'File suggestions • ↑/↓ or Ctrl+N/P navigate • Enter/Tab apply'}
    </text>
    {isIndexingFiles ? (
      <text fg="gray">Indexing files...</text>
    ) : fileSuggestions.length > 0 ? (
      <box flexDirection="column" width="100%">
        {fileSuggestions.map((suggestion, index) => (
          <box key={suggestion} paddingLeft={0} paddingRight={1} gap={0}>
            <text
              fg={index === selectedSuggestionIndex ? 'cyan' : 'gray'}
              wrapMode="char"
            >
              {index === selectedSuggestionIndex ? '› ' : '  '}
              {suggestion}
            </text>
          </box>
        ))}
        {selectedSuggestionVscodeLink && (
          <box flexDirection="column" width="100%">
            <text fg="gray" wrapMode="word">
              open file with:
            </text>
            <text
              fg="cyan"
              wrapMode="word"
              onMouseUp={() => {
                void openExternalLink(selectedSuggestionVscodeLink, 'vscode');
              }}
            >
              • VS Code
            </text>
            <text
              fg="cyan"
              wrapMode="word"
              onMouseUp={() => {
                void openExternalLink(
                  selectedSuggestionVscodeLink,
                  'vscode-insiders',
                );
              }}
            >
              • VS Code Insiders
            </text>
          </box>
        )}
      </box>
    ) : (
      <text fg="gray">
        {hasSearchRoot
          ? '#search: no matches'
          : '#search: no search root configured'}
      </text>
    )}
  </box>
);
