import { memo } from 'react';
import type { Attachment } from '../../types';
import { formatFileSize } from '../../lib/formatters';

type Props = {
  attachments: Attachment[];
  onRemove: (index: number) => void;
  onExpand?: (src: string, name: string) => void;
};

const AttachmentPreview = memo(function AttachmentPreview({
  attachments,
  onRemove,
  onExpand,
}: Props): React.ReactElement {
  return (
    <div className="flex gap-2 flex-wrap px-1">
      {attachments.map((att, i) => (
        <div key={i} className="relative group">
          {att.mimeType.startsWith('image/') ? (
            <div
              className="w-16 h-16 rounded-sm border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)] cursor-pointer hover:border-[var(--color-agent)] transition-colors"
              onClick={() =>
                onExpand?.(`data:${att.mimeType};base64,${att.data}`, att.name)
              }
              title="Click to expand"
            >
              <img
                src={`data:${att.mimeType};base64,${att.data}`}
                alt={att.name}
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="h-16 px-2 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col items-center justify-center gap-0.5">
              <span className="text-xs">📄</span>
              <span className="text-[9px] text-[var(--color-text-muted)] max-w-[60px] truncate">
                {att.name}
              </span>
            </div>
          )}
          <button
            onClick={() => onRemove(i)}
            className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--color-error)] text-white text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          >
            ×
          </button>
          <span className="absolute bottom-0 left-0 right-0 bg-[var(--color-bg)]/70 text-[8px] text-[var(--color-text-muted)] text-center py-0.5 truncate">
            {formatFileSize(att.size)}
          </span>
        </div>
      ))}
    </div>
  );
});

export default AttachmentPreview;
