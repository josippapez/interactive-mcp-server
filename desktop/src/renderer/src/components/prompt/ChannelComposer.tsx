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
  /** Show "Send with Reply" button for triggering agent response (OpenCode only) */
  showReplyButton?: boolean;
  /** Called when "Send with Reply" is clicked (noReply=false) */
  onSubmitWithReply?: (text: string, attachments?: Attachment[]) => void;
  /** Current noReply toggle state (controlled from parent) */
  noReply?: boolean;
  /** Called when noReply toggle changes */
  onNoReplyChange?: (noReply: boolean) => void;
};

export default function ChannelComposer({
  enabled,
  baseDirectory,
  placeholder,
  submitLabel = 'Send',
  onSubmit,
  showReplyButton = false,
  onSubmitWithReply,
  noReply = true,
  onNoReplyChange,
}: Props): React.ReactElement {
  const [value, setValue] = useState('');
  const [expandedImage, setExpandedImage] = useState<{
    src: string;
    name: string;
  } | null>(null);
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

  const submitWithReply = useCallback(() => {
    const text = value.trim();
    if (!enabled || (!text && attachments.length === 0) || !onSubmitWithReply)
      return;
    onSubmitWithReply(text, attachments.length > 0 ? attachments : undefined);
    setValue('');
    setAttachments([]);
    clearSuggestions();
  }, [
    enabled,
    value,
    attachments,
    onSubmitWithReply,
    setAttachments,
    clearSuggestions,
  ]);

  const disabled = useMemo(
    () => !enabled || (!value.trim() && attachments.length === 0),
    [enabled, value, attachments.length],
  );

  // Auto-grow textarea - use minHeight instead of min-h class to avoid scrollHeight issues
  // Maximum height is 1000px or 60% of viewport height, whichever is smaller
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    // Reset to minimum height first, then expand to content
    ta.style.height = '2.5rem'; // ~40px, matches rows={1} with padding
    const maxHeight = Math.min(1000, window.innerHeight * 0.6);
    const newHeight = Math.max(40, Math.min(ta.scrollHeight, maxHeight));
    ta.style.height = `${newHeight}px`;
  }, [value]);

  return (
    <>
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
                onExpand={(src, name) => setExpandedImage({ src, name })}
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
                detectAutocomplete(
                  next,
                  e.target.selectionStart ?? next.length,
                );
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
              className="w-full bg-[var(--color-surface-alt)] border border-[var(--color-input-border)] rounded-sm px-3 py-2 text-sm text-[var(--color-text)] placeholder-[var(--color-text-faint)] focus:border-[var(--color-tool)] focus:outline-none resize-none overflow-hidden max-h-[1000px] disabled:opacity-60"
              rows={1}
              style={{ height: '2.5rem' }}
            />
          </div>
          <div className="flex flex-col gap-1 self-end">
            <button
              type="button"
              onClick={handleFilePicker}
              disabled={!enabled}
              title="Attach file"
              className="px-2 py-2 rounded-sm text-[var(--color-text-muted)] hover:text-[var(--color-agent)] hover:bg-[var(--color-agent)]/10 transition-colors text-sm disabled:opacity-40"
            >
              📎
            </button>
            {/* Reply toggle switch - only show when reply button is available */}
            {showReplyButton && onNoReplyChange && (
              <label
                className="flex items-center gap-1.5 cursor-pointer select-none"
                title={
                  noReply
                    ? 'Reply OFF — message will be queued without triggering agent response'
                    : 'Reply ON — message will trigger agent response'
                }
              >
                <span
                  className={`text-[10px] font-medium transition-colors ${
                    noReply
                      ? 'text-[var(--color-text-muted)]'
                      : 'text-[var(--color-text-secondary)]'
                  }`}
                >
                  Reply
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!noReply}
                  onClick={() => onNoReplyChange(!noReply)}
                  disabled={!enabled}
                  className={`relative w-8 h-4 rounded-full transition-colors disabled:opacity-40 ${
                    noReply
                      ? 'bg-[var(--color-background-tertiary)] border border-[var(--color-border-primary)]'
                      : 'bg-[var(--color-success)]'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${
                      noReply
                        ? 'left-0.5 bg-[var(--color-text-muted)]'
                        : 'left-4 bg-white'
                    }`}
                  />
                </button>
              </label>
            )}
            <div className="flex gap-1">
              {showReplyButton && onSubmitWithReply && (
                <button
                  type="button"
                  onClick={submitWithReply}
                  disabled={disabled}
                  title="Send and trigger agent response (noReply=false)"
                  className="px-2 py-2 rounded-sm bg-[var(--color-user)] text-black text-xs font-medium hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  ↵
                </button>
              )}
              <button
                type="button"
                onClick={submit}
                disabled={disabled}
                className="px-3 py-2 rounded-sm bg-[var(--color-agent)] text-black text-xs font-medium hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                {submitLabel}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Expanded image modal (lightbox) */}
      {expandedImage && (
        <div
          role="dialog"
          aria-label="Image preview"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setExpandedImage(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setExpandedImage(null);
          }}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between w-full mb-2 px-1">
              <span className="text-xs text-white/70 truncate max-w-[80%]">
                {expandedImage.name}
              </span>
              <button
                type="button"
                onClick={() => setExpandedImage(null)}
                className="text-white/70 hover:text-white text-sm px-2 py-0.5"
                aria-label="Close image preview"
              >
                ESC
              </button>
            </div>
            <img
              src={expandedImage.src}
              alt={expandedImage.name}
              className="max-w-full max-h-[85vh] rounded-sm object-contain"
            />
          </div>
        </div>
      )}
    </>
  );
}
