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

/**
 * Module-level set of tool call IDs that have already played their
 * enter animation. Virtualization can unmount a row when it scrolls out
 * of view and remount when it returns — without this guard the fade-in
 * would re-play every time, which is visually wrong and causes
 * unnecessary GSAP work. The set grows monotonically for the lifetime
 * of the page; tool IDs are UUIDs so collisions across sessions are
 * not a concern, and page reload clears it naturally.
 */
const animatedToolIds = new Set<string>();

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
      // Skip the fade if this exact tool call has already animated once.
      // Guards against virtualization remount replaying the enter animation.
      if (animatedToolIds.has(tool.id)) return;
      animatedToolIds.add(tool.id);
      gsap.from(containerRef.current, {
        opacity: 0,
        y: 5,
        duration: 0.2,
        ease: 'power2.out',
      });
    },
    { scope: containerRef, dependencies: [tool.id] },
  );

  return (
    <div ref={containerRef}>
      {resolveToolCard(tool, forceExpanded, onNavigateToSession)}
    </div>
  );
});

export default ToolCallView;
