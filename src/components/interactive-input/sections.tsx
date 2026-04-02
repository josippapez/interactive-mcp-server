import type React from 'react';
import type { TextareaRenderableLike } from './types.js';
import type { ThemeColors } from '@/theme.js';
import { openExternalLink } from '@/utils/open-external-link.js';
import {
  routeTextareaMouseScroll,
  type MouseScrollEventLike,
} from './scroll-routing.js';

interface ModeTabsProps {
  mode: 'option' | 'input';
  hasOptions: boolean;
  theme: ThemeColors;
  onSelectOptionMode: () => void;
  onSelectInputMode: () => void;
}

export const ModeTabs = ({
  mode,
  hasOptions,
  theme,
  onSelectOptionMode,
  onSelectInputMode,
}: ModeTabsProps) => (
  <box flexDirection="column" marginBottom={0} width="100%" gap={0}>
    <text fg={theme.textMuted}>Mode</text>
    <box
      flexDirection="row"
      alignSelf="flex-start"
      border
      borderStyle="single"
      borderColor={theme.borderMode}
      backgroundColor={theme.bgModeTabs}
      paddingLeft={0}
      paddingRight={0}
    >
      {hasOptions && (
        <box
          justifyContent="center"
          paddingLeft={0}
          paddingRight={0}
          onClick={onSelectOptionMode}
          backgroundColor={
            mode === 'option' ? theme.modeTabActiveBg : theme.bgModeTabs
          }
        >
          <text
            fg={
              mode === 'option'
                ? theme.modeTabActiveText
                : theme.modeTabInactiveText
            }
          >
            {mode === 'option' ? 'Option' : 'option'}
          </text>
        </box>
      )}
      {hasOptions && <text fg={theme.separator}>│</text>}
      <box
        justifyContent="center"
        paddingLeft={0}
        paddingRight={0}
        onClick={onSelectInputMode}
        backgroundColor={
          mode === 'input' ? theme.modeTabActiveBg : theme.bgModeTabs
        }
      >
        <text
          fg={
            mode === 'input'
              ? theme.modeTabActiveText
              : theme.modeTabInactiveText
          }
        >
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
  theme: ThemeColors;
  onSelectOption: (index: number) => void;
  onActivateOptionMode: () => void;
}

export const OptionList = ({
  mode,
  options,
  selectedIndex,
  theme,
  onSelectOption,
  onActivateOptionMode,
}: OptionListProps) => {
  if (options.length === 0) {
    return null;
  }

  return (
    <box flexDirection="column" marginBottom={0} width="100%" gap={0}>
      <text fg={theme.textMuted} wrapMode="word">
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
                index === selectedIndex && mode === 'option'
                  ? theme.textAccent
                  : theme.textMuted
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
  theme: ThemeColors;
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
  theme,
  keyBindings,
  onFocusRequest,
  onContentSync,
  onSubmitFromTextarea,
  focused = true,
}: InputEditorProps) => (
  <box flexDirection="column" marginBottom={0} width="100%">
    <text fg={theme.textMuted}>Input</text>
    <box
      border
      borderStyle="single"
      borderColor={
        hasSuggestions ? theme.borderInputSuggestions : theme.borderInputDefault
      }
      backgroundColor={theme.bgInput}
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
        backgroundColor={theme.bgInput}
        focusedBackgroundColor={theme.bgInput}
        textColor={theme.textPrimary}
        focusedTextColor={theme.textPrimary}
        placeholderColor={theme.textMuted}
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
  theme: ThemeColors;
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
  theme,
  scrollRef,
}: SuggestionsPanelProps) => (
  <box flexDirection="column" marginBottom={0} width="100%" gap={0}>
    <text fg={theme.textMuted}>
      {hasOptions
        ? 'Path suggestions (files + folders) • ↑/↓ or Ctrl+N/P navigate • Enter/Tab apply'
        : 'Path suggestions (files + folders) • ↑/↓ or Ctrl+N/P navigate • Enter/Tab apply'}
    </text>
    {isIndexingFiles ? (
      <text fg={theme.textMuted}>Indexing files...</text>
    ) : fileSuggestions.length > 0 ? (
      <box flexDirection="column" width="100%">
        <text fg={theme.textMuted}>Showing up to 50 results</text>
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
                  fg={
                    index === selectedSuggestionIndex
                      ? theme.textAccent
                      : theme.textMuted
                  }
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
            <text fg={theme.textMuted} wrapMode="word">
              open file with:
            </text>
            <text
              fg={theme.textAccent}
              wrapMode="word"
              onMouseUp={() => {
                void openExternalLink(selectedSuggestionVscodeLink, 'vscode');
              }}
            >
              • VS Code
            </text>
            <text
              fg={theme.textAccent}
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
      <text fg={theme.textMuted}>
        {hasSearchRoot
          ? '#search: no matches'
          : '#search: no search root configured'}
      </text>
    )}
  </box>
);

interface QuestionBoxProps {
  question: string;
  theme: ThemeColors;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  MarkdownTextComponent: any;
}

export const QuestionBox = ({
  question,
  theme,
  MarkdownTextComponent,
}: QuestionBoxProps) => (
  <box
    flexDirection="column"
    marginBottom={0}
    gap={0}
    border
    borderStyle="single"
    borderColor={theme.borderPrompt}
    backgroundColor={theme.bgPromptBox}
    paddingLeft={1}
    paddingRight={1}
    paddingTop={1}
    paddingBottom={1}
  >
    <text fg={theme.textAccent}>
      <strong>PROMPT</strong>
    </text>
    <MarkdownTextComponent
      content={question}
      theme={theme}
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
  theme: ThemeColors;
}

export const SearchStatus = ({
  isIndexingFiles,
  repositoryFiles,
  searchRoot,
  hasSearchRoot,
  theme,
}: SearchStatusProps) => (
  <box flexDirection="column" marginBottom={0} width="100%">
    <text fg={theme.textMuted} wrapMode="char">
      {hasSearchRoot
        ? `#search root: ${searchRoot}`
        : '#search root: no search root'}
    </text>
    <text fg={theme.textMuted}>
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
  theme: ThemeColors;
  queuedAttachments: Array<{ id: string }>;
}

export const InputStatus = ({
  mode,
  isNarrow,
  inputValue,
  theme,
  queuedAttachments,
}: InputStatusProps) => (
  <box
    flexDirection={isNarrow ? 'column' : 'row'}
    justifyContent="space-between"
    marginBottom={0}
    gap={isNarrow ? 0 : undefined}
  >
    <text fg={theme.textMuted}>
      {mode === 'input' ? 'Custom input' : 'Option selection'}
    </text>
    <text fg={theme.textMuted}>
      {mode === 'input' && queuedAttachments.length > 0
        ? `${inputValue.length} chars + ${queuedAttachments.length} queued`
        : `${inputValue.length} chars`}
    </text>
  </box>
);

interface ClipboardStatusProps {
  status: string;
  theme: ThemeColors;
}

export const ClipboardStatus = ({ status, theme }: ClipboardStatusProps) => (
  <text
    fg={
      status.startsWith('Copy failed:')
        ? theme.clipboardError
        : theme.clipboardSuccess
    }
  >
    {status}
  </text>
);

interface AttachmentsDisplayProps {
  queuedAttachments: Array<{ id: string; label: string }>;
  theme: ThemeColors;
}

export const AttachmentsDisplay = ({
  queuedAttachments,
  theme,
}: AttachmentsDisplayProps) => (
  <box flexDirection="column" width="100%" gap={0}>
    <text fg={theme.attachmentLabel}>
      <strong>QUEUED ATTACHMENTS</strong> (Delete placeholder text to remove)
    </text>
    {queuedAttachments.map((attachment, index) => (
      <text key={attachment.id} fg={theme.textMuted} wrapMode="word">
        [File {index + 1}] {attachment.label}
      </text>
    ))}
  </box>
);

interface SendButtonProps {
  theme: ThemeColors;
}

export const SendButton = ({ theme }: SendButtonProps) => (
  <box
    backgroundColor={theme.sendBg}
    paddingLeft={1}
    paddingRight={1}
    alignSelf="flex-start"
    marginBottom={0}
  >
    <text fg={theme.sendText}>
      <strong>Send</strong> ⌃S
    </text>
  </box>
);

interface HelpTextProps {
  hasOptions: boolean;
  theme: ThemeColors;
}

export const HelpText = ({ hasOptions, theme }: HelpTextProps) => (
  <text fg={theme.textMuted} wrapMode="word">
    {hasOptions
      ? 'Enter/Ctrl+J newline • #search nav: ↑/↓ or Ctrl+N/P • Enter/Tab #search apply • Tab mode switch (when #search suggestions are hidden) • #path for repo file/folder autocomplete • Cmd/Ctrl+C copy input • Cmd/Ctrl+V paste/attach • Cmd/Ctrl+Z undo • Cmd/Ctrl+Shift+Z redo • Ctrl+T toggle theme'
      : 'Enter/Ctrl+J newline • #search nav: ↑/↓ or Ctrl+N/P • Enter/Tab #search apply • #path for repo file/folder autocomplete • Cmd/Ctrl+C copy input • Cmd/Ctrl+V paste/attach • Cmd/Ctrl+Z undo • Cmd/Ctrl+Shift+Z redo • Ctrl+T toggle theme'}
  </text>
);
