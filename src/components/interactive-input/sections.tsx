import type React from 'react';
import type { TextareaRenderableLike } from './types.js';
import { openExternalLink } from '@/utils/open-external-link.js';
import {
  routeTextareaMouseScroll,
  type MouseScrollEventLike,
} from './scroll-routing.js';

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
    <box flexDirection="column" marginBottom={0} width="100%" gap={0}>
      <text fg="gray" wrapMode="word">
        Option mode: ↑/↓ or j/k choose • Enter select • Tab switch mode
      </text>
      <box flexDirection="column" width="100%" gap={0}>
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
  textareaSyntaxStyle?: unknown;
  textareaContainerHeight: number;
  textareaRows: number;
  hasSuggestions: boolean;
  keyBindings: Array<Record<string, unknown>>;
  onFocusRequest: () => void;
  onContentSync: () => void;
  onSubmitFromTextarea: () => void;
  focused?: boolean;
}

export const InputEditor = ({
  questionId,
  textareaRenderVersion,
  textareaRef,
  textareaSyntaxStyle,
  textareaContainerHeight,
  textareaRows,
  hasSuggestions,
  keyBindings,
  onFocusRequest,
  onContentSync,
  onSubmitFromTextarea,
  focused = true,
}: InputEditorProps) => (
  <box flexDirection="column" marginBottom={0} width="100%">
    <text fg="gray">Input</text>
    <box
      border
      borderStyle="single"
      borderColor={hasSuggestions ? 'cyan' : 'gray'}
      backgroundColor="#1f1f1f"
      height={textareaContainerHeight}
      paddingLeft={1}
      paddingRight={1}
      onClick={onFocusRequest}
    >
      <textarea
        ref={textareaRef}
        key={`textarea-${questionId}-${textareaRenderVersion}`}
        focused={focused}
        height={textareaRows}
        wrapMode="word"
        backgroundColor="#1f1f1f"
        focusedBackgroundColor="#1f1f1f"
        textColor="white"
        focusedTextColor="white"
        placeholderColor="gray"
        placeholder="Type your answer..."
        syntaxStyle={textareaSyntaxStyle as never}
        keyBindings={keyBindings}
        onContentChange={onContentSync}
        onCursorChange={onContentSync}
        onMouseScroll={(event: MouseScrollEventLike) =>
          routeTextareaMouseScroll(event, textareaRef.current)
        }
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
  scrollRef: {
    current: {
      scrollTo?: (position: number | { x: number; y: number }) => void;
    } | null;
  };
}

export const SuggestionsPanel = ({
  hasOptions,
  isIndexingFiles,
  fileSuggestions,
  selectedSuggestionIndex,
  selectedSuggestionVscodeLink,
  hasSearchRoot,
  scrollRef,
}: SuggestionsPanelProps) => (
  <box flexDirection="column" marginBottom={0} width="100%" gap={0}>
    <text fg="gray">
      {hasOptions
        ? 'Path suggestions (files + folders) • ↑/↓ or Ctrl+N/P navigate • Enter/Tab apply'
        : 'Path suggestions (files + folders) • ↑/↓ or Ctrl+N/P navigate • Enter/Tab apply'}
    </text>
    {isIndexingFiles ? (
      <text fg="gray">Indexing files...</text>
    ) : fileSuggestions.length > 0 ? (
      <box flexDirection="column" width="100%">
        <text fg="gray">Showing up to 50 results</text>
        <scrollbox
          ref={scrollRef}
          width="100%"
          height={6}
          scrollY
          viewportCulling
          scrollbarOptions={{
            showArrows: false,
          }}
        >
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
          </box>
        </scrollbox>
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

interface QuestionBoxProps {
  question: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  MarkdownTextComponent: any;
}

export const QuestionBox = ({
  question,
  MarkdownTextComponent,
}: QuestionBoxProps) => (
  <box
    flexDirection="column"
    marginBottom={0}
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
    <MarkdownTextComponent
      content={question}
      showContentCopyControl
      showCodeCopyControls
    />
  </box>
);

interface SearchStatusProps {
  isIndexingFiles: boolean;
  repositoryFiles: string[];
  searchRoot?: string;
  hasSearchRoot: boolean;
}

export const SearchStatus = ({
  isIndexingFiles,
  repositoryFiles,
  searchRoot,
  hasSearchRoot,
}: SearchStatusProps) => (
  <box flexDirection="column" marginBottom={0} width="100%">
    <text fg="gray" wrapMode="char">
      {hasSearchRoot
        ? `#search root: ${searchRoot}`
        : '#search root: no search root'}
    </text>
    <text fg="gray">
      {isIndexingFiles
        ? '#search index: indexing...'
        : `#search index: ${repositoryFiles.length} paths indexed`}
    </text>
  </box>
);

interface InputStatusProps {
  mode: 'option' | 'input';
  isNarrow: boolean;
  inputValue: string;
  queuedAttachments: Array<{ id: string }>;
}

export const InputStatus = ({
  mode,
  isNarrow,
  inputValue,
  queuedAttachments,
}: InputStatusProps) => (
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
);

interface ClipboardStatusProps {
  status: string;
}

export const ClipboardStatus = ({ status }: ClipboardStatusProps) => (
  <text fg={status.startsWith('Copy failed:') ? 'red' : 'green'}>{status}</text>
);

interface AttachmentsDisplayProps {
  queuedAttachments: Array<{ id: string; label: string }>;
}

export const AttachmentsDisplay = ({
  queuedAttachments,
}: AttachmentsDisplayProps) => (
  <box flexDirection="column" width="100%" gap={0}>
    <text fg="yellow">
      <strong>QUEUED ATTACHMENTS</strong> (Delete placeholder text to remove)
    </text>
    {queuedAttachments.map((attachment, index) => (
      <text key={attachment.id} fg="gray" wrapMode="word">
        [File {index + 1}] {attachment.label}
      </text>
    ))}
  </box>
);

export const SendButton = () => (
  <box
    backgroundColor="cyan"
    paddingLeft={1}
    paddingRight={1}
    alignSelf="flex-start"
    marginBottom={0}
  >
    <text fg="black">
      <strong>Send</strong> ⌃S
    </text>
  </box>
);

interface HelpTextProps {
  hasOptions: boolean;
}

export const HelpText = ({ hasOptions }: HelpTextProps) => (
  <text fg="gray" wrapMode="word">
    {hasOptions
      ? 'Enter/Ctrl+J newline • #search nav: ↑/↓ or Ctrl+N/P • Enter/Tab #search apply • Tab mode switch (when #search suggestions are hidden) • #path for repo file/folder autocomplete • Cmd/Ctrl+C copy input • Cmd/Ctrl+V paste/attach • Cmd/Ctrl+Z undo • Cmd/Ctrl+Shift+Z redo'
      : 'Enter/Ctrl+J newline • #search nav: ↑/↓ or Ctrl+N/P • Enter/Tab #search apply • #path for repo file/folder autocomplete • Cmd/Ctrl+C copy input • Cmd/Ctrl+V paste/attach • Cmd/Ctrl+Z undo • Cmd/Ctrl+Shift+Z redo'}
  </text>
);
