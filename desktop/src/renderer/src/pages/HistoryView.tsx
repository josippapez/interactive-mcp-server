import { useState, useEffect } from 'react';
import CollapsibleSection from '../components/CollapsibleSection';
import MarkdownContent from '../components/MarkdownContent';
import type { Attachment, ConversationRecord } from '../types';

export default function HistoryView(): React.ReactElement {
  const [history, setHistory] = useState<ConversationRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHistory = async (): Promise<void> => {
    setLoading(true);
    const data = await window.api.getHistory();
    setHistory(data);
    setLoading(false);
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleClear = async (): Promise<void> => {
    await window.api.clearHistory();
    setHistory([]);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-sm">
        Loading…
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)] gap-2">
        <p className="text-sm">No conversation history yet.</p>
        <p className="text-xs text-[var(--color-text-faint)]">
          Prompts and responses will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-[var(--color-border)]">
        <span className="text-xs text-[var(--color-text-muted)]">
          {history.length} conversation{history.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={handleClear}
          className="text-xs text-[var(--color-error)] hover:opacity-80 transition-colors"
        >
          Clear all
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {history.map((item, index) => (
          <CollapsibleSection
            key={item.id}
            title={`${item.projectName} — ${new Date(item.createdAt).toLocaleString()}`}
            defaultOpen={index === 0}
          >
            <div className="space-y-2">
              <div className="msg-agent pl-3 py-1">
                <MarkdownContent content={item.promptMessage} />
              </div>
              <div className="msg-user pl-3 py-1">
                <MarkdownContent content={item.userResponse} />
                {(() => {
                  if (!item.attachments) return null;
                  let atts: Attachment[];
                  try {
                    atts = JSON.parse(item.attachments);
                  } catch {
                    return null;
                  }
                  if (!atts.length) return null;
                  return (
                    <div className="flex gap-2 flex-wrap mt-2">
                      {atts.map((att, i) => (
                        <div
                          key={i}
                          className="w-14 h-14 rounded-sm border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)]"
                        >
                          <img
                            src={`data:${att.mimeType};base64,${att.data}`}
                            alt={att.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          </CollapsibleSection>
        ))}
      </div>
    </div>
  );
}
