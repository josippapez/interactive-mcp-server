import React, { memo, useCallback, useEffect, useState } from 'react';
import type { ToolCallInfo } from '../../../types/unified-message';
import DiffView from '../DiffView';
import { ToolStatusBadge } from './ToolCallShared';

export const ReadToolRow = memo(function ReadToolRow({
  tool,
  readFilePath,
}: {
  tool: ToolCallInfo;
  readFilePath: string;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)]">
      <span className="text-[var(--color-tool)] font-mono text-[10px]">
        {tool.name}
      </span>
      <span className="text-[var(--color-text-muted)] font-mono text-[10px] truncate flex-1">
        {readFilePath}
      </span>
      <ToolStatusBadge status={tool.status} />
    </div>
  );
});

const EditToolRow = memo(function EditToolRow({
  tool,
  filePath,
  isExpanded,
  onToggle,
}: {
  tool: ToolCallInfo;
  filePath: string;
  isExpanded: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <div className="border border-[var(--color-border)] rounded overflow-hidden bg-[var(--color-surface)]">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-2 py-0.5 flex items-center justify-between text-left hover:bg-[var(--color-border)]/30 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="text-[var(--color-tool)] font-mono text-[10px] shrink-0">
            {tool.name}
          </span>
          <span className="text-[var(--color-text-muted)] font-mono text-[10px] truncate">
            {filePath}
          </span>
          <ToolStatusBadge status={tool.status} />
        </div>
        <span className="text-[var(--color-text-muted)] text-[10px] shrink-0 ml-1">
          {isExpanded ? '▾' : '▸'}
        </span>
      </button>

      {isExpanded && (
        <div className="border-t border-[var(--color-border)]">
          <DiffView tool={tool} />
        </div>
      )}
    </div>
  );
});

export const EditToolCard = memo(function EditToolCard({
  tool,
  filePath,
  forceExpanded,
}: {
  tool: ToolCallInfo;
  filePath: string;
  forceExpanded: boolean;
}): React.ReactElement {
  const [isExpanded, setIsExpanded] = useState(forceExpanded);

  useEffect(() => {
    setIsExpanded(forceExpanded);
  }, [forceExpanded]);

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  return (
    <EditToolRow
      tool={tool}
      filePath={filePath}
      isExpanded={isExpanded}
      onToggle={toggleExpanded}
    />
  );
});
