import React, { memo, useRef } from 'react';
import type { ToolCallInfo } from '../../types/unified-message';
import TodoWriteToolCard, {
  isTodoWriteToolCall,
} from './tool-call/TodoWriteToolCard';
import ApplyPatchToolCard, {
  isApplyPatchToolCall,
} from './tool-call/ApplyPatchToolCard';
import { DefaultToolCard } from './tool-call/DefaultToolCard';
import { EditToolCard, ReadToolRow } from './tool-call/FileToolCards';
import {
  isEditToolCall,
  isReadToolCall,
  parseEditToolInput,
  parseReadToolInput,
} from '../../lib/diff-parser';
import { gsap, useGSAP, prefersReducedMotion } from '../../lib/gsap';

function resolveToolCard(
  tool: ToolCallInfo,
  forceExpanded: boolean,
  onNavigateToSession?: (sessionId: string) => void,
): React.ReactElement {
  const isRead = isReadToolCall(tool.name);
  if (isRead) {
    const readFilePath = parseReadToolInput(tool.input);
    if (readFilePath) {
      return <ReadToolRow tool={tool} readFilePath={readFilePath} />;
    }
  }

  const isEdit = isEditToolCall(tool.name);
  if (isEdit) {
    const editInput = parseEditToolInput(tool.input);
    if (editInput) {
      return (
        <EditToolCard
          tool={tool}
          filePath={editInput.filePath}
          forceExpanded={forceExpanded}
        />
      );
    }
  }

  if (isTodoWriteToolCall(tool.name)) {
    return <TodoWriteToolCard tool={tool} />;
  }

  if (isApplyPatchToolCall(tool.name)) {
    return <ApplyPatchToolCard tool={tool} forceExpanded={forceExpanded} />;
  }

  return (
    <DefaultToolCard
      tool={tool}
      forceExpanded={forceExpanded}
      onNavigateToSession={onNavigateToSession}
    />
  );
}

const ToolCallView = memo(function ToolCallView({
  tool,
  forceExpanded = false,
  onNavigateToSession,
}: {
  tool: ToolCallInfo;
  forceExpanded?: boolean;
  onNavigateToSession?: (sessionId: string) => void;
}): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.from(containerRef.current, {
        opacity: 0,
        y: 5,
        duration: 0.2,
        ease: 'power2.out',
      });
    },
    { scope: containerRef },
  );

  return (
    <div ref={containerRef}>
      {resolveToolCard(tool, forceExpanded, onNavigateToSession)}
    </div>
  );
});

export default ToolCallView;
