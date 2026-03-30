import { useState, useEffect, useRef, useCallback } from 'react';
import MarkdownContent from './MarkdownContent';
import type { PromptData, ChatMessage } from '../types';

type Props = {
  prompt: PromptData | null;
  activeSession: { id: string; title: string } | null;
  chatHistory: ChatMessage[];
  onSubmit: (answer: string) => void;
  onSelectOption: (option: string) => void;
};

type AutocompleteTarget = {
  start: number;
  end: number;
  query: string;
};

export default function PromptView({
  prompt,
  activeSession,
  chatHistory,
  onSubmit,
  onSelectOption,
}: Props): JSX.Element {
  const [answer, setAnswer] = useState('');
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Autocomplete state
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [autocompleteTarget, setAutocompleteTarget] =
    useState<AutocompleteTarget | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const baseDirectory = prompt?.baseDirectory;
  const showSuggestions =
    autocompleteTarget !== null && (isLoading || suggestions.length > 0);

  // Focus textarea when a new prompt arrives
  useEffect(() => {
    if (prompt) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [prompt?.id]);

  // Countdown timer
  useEffect(() => {
    if (!prompt || !prompt.timeoutSeconds || prompt.timeoutSeconds <= 0) {
      setSecondsLeft(null);
      return;
    }
    setSecondsLeft(prompt.timeoutSeconds);
    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [prompt?.id, prompt?.timeoutSeconds]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  // Clear autocomplete when prompt changes
  useEffect(() => {
    setSuggestions([]);
    setAutocompleteTarget(null);
    setSelectedIndex(0);
  }, [prompt?.id]);

  // Detect # trigger and search files
  const detectAutocomplete = useCallback(
    (text: string, cursorPos: number) => {
      if (!baseDirectory) {
        setAutocompleteTarget(null);
        setSuggestions([]);
        return;
      }

      // Scan backward from cursor to find #
      let hashIdx = -1;
      for (let i = cursorPos - 1; i >= 0; i--) {
        const ch = text[i];
        if (ch === '#') {
          hashIdx = i;
          break;
        }
        // Stop if we hit whitespace before finding #
        if (ch === '\n') break;
      }

      if (hashIdx === -1) {
        setAutocompleteTarget(null);
        setSuggestions([]);
        return;
      }

      const query = text.slice(hashIdx + 1, cursorPos);

      setAutocompleteTarget({ start: hashIdx, end: cursorPos, query });
      setSelectedIndex(0);

      // Debounce the IPC call
      if (debounceRef.current) clearTimeout(debounceRef.current);

      setIsLoading(true);
      debounceRef.current = setTimeout(async () => {
        try {
          const results = await window.api.searchFiles(baseDirectory, query);
          setSuggestions(results);
        } catch {
          setSuggestions([]);
        } finally {
          setIsLoading(false);
        }
      }, 150);
    },
    [baseDirectory],
  );

  const applySuggestion = useCallback(
    (filePath: string) => {
      if (!autocompleteTarget) return;

      const before = answer.slice(0, autocompleteTarget.start);
      const after = answer.slice(autocompleteTarget.end);
      const newValue = before + filePath + after;

      setAnswer(newValue);
      setSuggestions([]);
      setAutocompleteTarget(null);
      setSelectedIndex(0);

      // Re-focus textarea and set cursor position
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          const newCursor = before.length + filePath.length;
          ta.selectionStart = newCursor;
          ta.selectionEnd = newCursor;
        }
      });
    },
    [answer, autocompleteTarget],
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const newValue = e.target.value;
    setAnswer(newValue);
    detectAutocomplete(newValue, e.target.selectionStart ?? newValue.length);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : 0,
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : suggestions.length - 1,
        );
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applySuggestion(suggestions[selectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSuggestions([]);
        setAutocompleteTarget(null);
        return;
      }
    }

    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
  };

  // Scroll selected suggestion into view
  useEffect(() => {
    if (!suggestionsRef.current) return;
    const selected = suggestionsRef.current.children[
      selectedIndex
    ] as HTMLElement;
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const submit = (): void => {
    if (!prompt || !answer.trim()) return;
    onSubmit(answer.trim());
    setAnswer('');
    setSuggestions([]);
    setAutocompleteTarget(null);
  };

  const selectOption = (option: string): void => {
    if (!prompt) return;
    onSelectOption(option);
    setAnswer('');
    setSuggestions([]);
    setAutocompleteTarget(null);
  };

  const idle = !prompt && !activeSession;

  // Idle state
  if (idle) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
        <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center">
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        </div>
        <p className="text-sm">Waiting for prompt from MCP client…</p>
        <p className="text-xs text-gray-600">SSE server running on port 3100</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Session badge */}
      {activeSession && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 bg-gray-900/50">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs text-gray-400">
            Intensive Chat:{' '}
            <span className="text-gray-300">{activeSession.title}</span>
          </span>
        </div>
      )}

      {/* Chat history (intensive chat mode) */}
      {activeSession && chatHistory.length > 0 && (
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {chatHistory.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.type === 'answer' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  msg.type === 'answer'
                    ? 'bg-violet-600 text-white'
                    : 'bg-gray-800 text-gray-200'
                }`}
              >
                <MarkdownContent content={msg.text} />
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
      )}

      {/* Current prompt (non-session or waiting for answer) */}
      {prompt && !activeSession && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex items-center gap-2 mb-3">
            {prompt.projectName && (
              <span className="px-2 py-0.5 rounded bg-violet-600/20 text-violet-400 text-xs font-medium">
                {prompt.projectName}
              </span>
            )}
            {secondsLeft !== null && (
              <span
                className={`ml-auto px-2 py-0.5 rounded text-xs font-mono ${
                  secondsLeft === 0
                    ? 'bg-red-600/20 text-red-400'
                    : secondsLeft <= 60
                      ? 'bg-amber-600/20 text-amber-400'
                      : 'bg-gray-800 text-gray-400'
                }`}
              >
                ⏱ {formatTime(secondsLeft)}
              </span>
            )}
          </div>
          <div className="prose prose-invert prose-sm max-w-none">
            <MarkdownContent content={prompt.message} />
          </div>
        </div>
      )}

      {/* Waiting for next question in intensive chat */}
      {activeSession && !prompt && (
        <div className="flex items-center justify-center py-4 text-gray-500 text-sm">
          <span className="animate-pulse">Waiting for next question…</span>
        </div>
      )}

      {/* Predefined options */}
      {prompt?.predefinedOptions && prompt.predefinedOptions.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          {prompt.predefinedOptions.map((option) => (
            <button
              key={option}
              onClick={() => selectOption(option)}
              className="px-3 py-1.5 rounded-lg border border-gray-700 text-sm text-gray-300 hover:border-violet-500 hover:text-violet-400 transition-colors"
            >
              {option}
            </button>
          ))}
        </div>
      )}

      {/* Free text input */}
      {prompt && (
        <div className="border-t border-gray-800">
          {activeSession && secondsLeft !== null && (
            <div className="flex justify-end px-4 pt-2">
              <span
                className={`px-2 py-0.5 rounded text-xs font-mono ${
                  secondsLeft === 0
                    ? 'bg-red-600/20 text-red-400'
                    : secondsLeft <= 60
                      ? 'bg-amber-600/20 text-amber-400'
                      : 'bg-gray-800 text-gray-400'
                }`}
              >
                ⏱ {formatTime(secondsLeft)}
              </span>
            </div>
          )}
          <div className="relative flex gap-2 p-4 pt-2">
            {/* Autocomplete dropdown */}
            {showSuggestions && (
              <div
                className="absolute left-4 right-16 bottom-full mb-1 z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-h-64 overflow-y-auto"
                ref={suggestionsRef}
              >
                {isLoading && suggestions.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-gray-500 italic">
                    Indexing…
                  </div>
                ) : suggestions.length === 0 && !isLoading ? (
                  <div className="px-3 py-2 text-xs text-gray-500 italic">
                    No matches
                  </div>
                ) : (
                  suggestions.slice(0, 50).map((filePath, i) => {
                    const segments = filePath.split('/');
                    const fileName = segments.pop() ?? filePath;
                    const dirPath = segments.join('/');
                    return (
                      <div
                        key={filePath}
                        className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm ${
                          i === selectedIndex
                            ? 'bg-violet-600/20 text-violet-400'
                            : 'text-gray-300 hover:bg-gray-800'
                        }`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          applySuggestion(filePath);
                        }}
                        onMouseEnter={() => setSelectedIndex(i)}
                      >
                        <svg
                          className="w-3.5 h-3.5 flex-shrink-0 text-gray-500"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                          />
                        </svg>
                        <span className="truncate">
                          <span className="font-medium">{fileName}</span>
                          {dirPath && (
                            <span className="text-gray-500 ml-1 text-xs">
                              {dirPath}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={answer}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={
                baseDirectory
                  ? 'Type your answer… (# for files, ⌘+Enter to send)'
                  : 'Type your answer… (⌘+Enter to send)'
              }
              className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-violet-500 focus:outline-none resize-none"
              rows={2}
            />
            <button
              onClick={submit}
              disabled={!answer.trim()}
              className="self-end px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
