import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import type { Attachment } from '../../types';
import AttachmentPreview from './AttachmentPreview';
import AutocompleteDropdown from './AutocompleteDropdown';
import { useAutocomplete } from '../../hooks/useAutocomplete';
import { useAttachments } from '../../hooks/useAttachments';

type Props = {
  enabled: boolean;
  baseDirectory?: string;
  placeholder: string;
  submitLabel?: string;
  onSubmit: (text: string, attachments?: Attachment[]) => void;
};

export default function ChannelComposer({
  enabled,
  baseDirectory,
  placeholder,
  submitLabel = 'Send',
  onSubmit,
}: Props): React.ReactElement {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    target,
    suggestions,
    loading,
    selectedIndex,
    setSelectedIndex,
    detectAutocomplete,
    applySuggestion,
    clearSuggestions,
  } = useAutocomplete(baseDirectory);

  const {
    attachments,
    setAttachments,
    handlePaste,
    handleFilePicker,
    removeAttachment,
  } = useAttachments(enabled);

  const showSuggestions =
    target !== null && (loading || suggestions.length > 0);
  const triggerChar: '#' | '@' =
    target !== null && value[target.start] === '@' ? '@' : '#';

  const focusTextarea = useCallback((cursorPos: number) => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    ta.selectionStart = cursorPos;
    ta.selectionEnd = cursorPos;
  }, []);

  const handleApplySuggestion = useCallback(
    (filePath: string) => {
      applySuggestion(filePath, () => value, setValue, focusTextarea);
    },
    [applySuggestion, value, focusTextarea],
  );

  const submit = useCallback(() => {
    const text = value.trim();
    if (!enabled || (!text && attachments.length === 0)) return;
    onSubmit(text, attachments.length > 0 ? attachments : undefined);
    setValue('');
    setAttachments([]);
    clearSuggestions();
  }, [enabled, value, attachments, onSubmit, setAttachments, clearSuggestions]);

  const disabled = useMemo(
    () => !enabled || (!value.trim() && attachments.length === 0),
    [enabled, value, attachments.length],
  );

  // Auto-grow textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [value]);

  return (
    <div className="border-t border-[var(--color-border)]">
      <div className="relative flex items-end gap-2 p-3">
        {showSuggestions && (
          <AutocompleteDropdown
            suggestions={suggestions}
            selectedIndex={selectedIndex}
            isLoading={loading}
            triggerChar={triggerChar}
            onSelect={handleApplySuggestion}
            onHoverIndex={setSelectedIndex}
          />
        )}
        <span className="text-[var(--color-user)] text-sm pb-2 select-none">
          ❯
        </span>
        <div className="flex-1 flex flex-col gap-1.5">
          {attachments.length > 0 && (
            <AttachmentPreview
              attachments={attachments}
              onRemove={removeAttachment}
              onExpand={() => undefined}
            />
          )}
          <textarea
            ref={textareaRef}
            value={value}
            disabled={!enabled}
            onPaste={handlePaste}
            onChange={(e) => {
              const next = e.target.value;
              setValue(next);
              detectAutocomplete(next, e.target.selectionStart ?? next.length);
            }}
            onKeyDown={(e) => {
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
                  handleApplySuggestion(suggestions[selectedIndex]);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  clearSuggestions();
                  return;
                }
              }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={placeholder}
            className="w-full bg-[var(--color-surface-alt)] border border-[var(--color-input-border)] rounded-sm px-3 py-2 text-sm text-[var(--color-text)] placeholder-[var(--color-text-faint)] focus:border-[var(--color-tool)] focus:outline-none resize-none overflow-hidden min-h-[4rem] max-h-[40vh] disabled:opacity-60"
            rows={1}
          />
        </div>
        <div className="flex flex-col gap-1 self-end">
          <button
            onClick={handleFilePicker}
            disabled={!enabled}
            title="Attach file"
            className="px-2 py-2 rounded-sm text-[var(--color-text-muted)] hover:text-[var(--color-agent)] hover:bg-[var(--color-agent)]/10 transition-colors text-sm disabled:opacity-40"
          >
            📎
          </button>
          <button
            onClick={submit}
            disabled={disabled}
            className="px-3 py-2 rounded-sm bg-[var(--color-agent)] text-black text-xs font-medium hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
