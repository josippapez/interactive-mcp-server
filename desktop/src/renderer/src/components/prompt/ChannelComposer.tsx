import { useMemo, useState, useRef, useCallback } from 'react';
import type { Attachment } from '../../types';
import AttachmentPreview from './AttachmentPreview';
import AutocompleteDropdown from './AutocompleteDropdown';

type Props = {
  enabled: boolean;
  baseDirectory?: string;
  placeholder: string;
  onSubmit: (text: string, attachments?: Attachment[]) => void;
};

type Target = { start: number; end: number; query: string };

export default function ChannelComposer({
  enabled,
  baseDirectory,
  placeholder,
  onSubmit,
}: Props): React.ReactElement {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [target, setTarget] = useState<Target | null>(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const showSuggestions =
    target !== null && (loading || suggestions.length > 0);
  const triggerChar: '#' | '@' =
    target !== null && value[target.start] === '@' ? '@' : '#';

  const detectAutocomplete = useCallback(
    (text: string, cursorPos: number) => {
      if (!baseDirectory) {
        setTarget(null);
        setSuggestions([]);
        return;
      }
      let triggerIdx = -1;
      for (let i = cursorPos - 1; i >= 0; i--) {
        const ch = text[i];
        if (ch === '#' || ch === '@') {
          triggerIdx = i;
          break;
        }
        if (ch === '\n') break;
      }
      if (triggerIdx === -1) {
        setTarget(null);
        setSuggestions([]);
        return;
      }
      const query = text.slice(triggerIdx + 1, cursorPos);
      setTarget({ start: triggerIdx, end: cursorPos, query });
      setSelectedIndex(0);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setLoading(true);
      debounceRef.current = setTimeout(async () => {
        try {
          const results = await window.api.searchFiles(baseDirectory, query);
          setSuggestions(results);
        } catch {
          setSuggestions([]);
        } finally {
          setLoading(false);
        }
      }, 150);
    },
    [baseDirectory],
  );

  const applySuggestion = useCallback(
    (filePath: string) => {
      if (!target) return;
      const before = value.slice(0, target.start);
      const after = value.slice(target.end);
      const next = before + filePath + after;
      setValue(next);
      setSuggestions([]);
      setTarget(null);
      setSelectedIndex(0);
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        const newCursor = before.length + filePath.length;
        ta.focus();
        ta.selectionStart = newCursor;
        ta.selectionEnd = newCursor;
      });
    },
    [target, value],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (!enabled) return;
      const items = Array.from(e.clipboardData.items);
      const imageItems = items.filter((item) => item.type.startsWith('image/'));
      if (imageItems.length === 0) return;
      e.preventDefault();
      for (const item of imageItems) {
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          if (!base64) return;
          setAttachments((prev) => [
            ...prev,
            {
              data: base64,
              mimeType: file.type || 'image/png',
              name: file.name || `pasted-image-${Date.now()}.png`,
              size: file.size,
            },
          ]);
        };
        reader.readAsDataURL(file);
      }
    },
    [enabled],
  );

  const handleFilePicker = useCallback(async () => {
    if (!enabled) return;
    const paths = await window.api.openFileDialog();
    for (const filePath of paths) {
      const result = await window.api.readFileForAttachment(filePath);
      if (!result) continue;
      setAttachments((prev) => [
        ...prev,
        {
          data: result.data,
          mimeType: result.mimeType,
          name: result.name,
          size: result.size,
        },
      ]);
    }
  }, [enabled]);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const submit = useCallback(() => {
    const text = value.trim();
    if (!enabled || (!text && attachments.length === 0)) return;
    onSubmit(text, attachments.length > 0 ? attachments : undefined);
    setValue('');
    setAttachments([]);
    setTarget(null);
    setSuggestions([]);
  }, [enabled, value, attachments, onSubmit]);

  const disabled = useMemo(
    () => !enabled || (!value.trim() && attachments.length === 0),
    [enabled, value, attachments.length],
  );

  return (
    <div className="border-t border-[var(--color-border)]">
      <div className="relative flex items-end gap-2 p-3">
        {showSuggestions && (
          <AutocompleteDropdown
            suggestions={suggestions}
            selectedIndex={selectedIndex}
            isLoading={loading}
            triggerChar={triggerChar}
            onSelect={applySuggestion}
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
                  applySuggestion(suggestions[selectedIndex]);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setSuggestions([]);
                  setTarget(null);
                  return;
                }
              }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={placeholder}
            className="w-full bg-[var(--color-surface-alt)] border border-[var(--color-input-border)] rounded-sm px-3 py-2 text-sm text-[var(--color-text)] placeholder-[var(--color-text-faint)] focus:border-[var(--color-tool)] focus:outline-none resize-y min-h-[4rem] max-h-[40vh] disabled:opacity-60"
            rows={3}
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
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
