import React, { memo } from 'react';
import type { ToolCallInfo } from '../../types/unified-message';
import TodoWriteToolCard, {
  isTodoWriteToolCall,
} from './tool-call/TodoWriteToolCard';
import ApplyPatchToolCard, {
  isApplyPatchToolCall,
} from './tool-call/ApplyPatchToolCard';
import { DefaultToolCard } from './tool-call/DefaultToolCard';
import { TaskToolCard, isTaskToolCall } from './tool-call/TaskToolCard';
import BackgroundSubagentToolCard, {
  isBackgroundSubagentToolCall,
} from './tool-call/BackgroundSubagentToolCard';
import { EditToolCard, ReadToolRow } from './tool-call/FileToolCards';
import { BashToolCard, isBashToolCall } from './tool-call/BashToolCard';
import GrepToolCard, { isGrepToolCall } from './tool-call/GrepToolCard';
import GlobToolCard, { isGlobToolCall } from './tool-call/GlobToolCard';
import {
  WebFetchToolCard,
  isWebFetchToolCall,
} from './tool-call/WebFetchToolCard';
import { WriteToolCard, isWriteToolCall } from './tool-call/WriteToolCard';
import TodoReadToolCard, {
  isTodoReadToolCall,
} from './tool-call/TodoReadToolCard';
import LspToolCard, { isLspToolCall } from './tool-call/LspToolCard';
import { getToolCategory } from './tool-call/tool-registry';
import {
  isEditToolCall,
  isReadToolCall,
  parseEditToolInput,
  parseReadToolInput,
} from '../../lib/diff-parser';

/**
 * Module-level set of tool call IDs that have already played their
 * enter animation. Virtualization can unmount a row when it scrolls out
 * of view and remount when it returns — without this guard the fade-in
 * would re-play every time, which is visually wrong. The set grows
 * monotonically for the lifetime of the page; tool IDs are UUIDs so
 * collisions across sessions are not a concern, and page reload clears
 * it naturally.
 *
 * NOTE (AI Elements migration): `ToolCallView` keeps its original
 * dispatcher shape. Specialized cards (`Read`, `Edit`, `TodoWrite`,
 * `ApplyPatch`) own their chrome; `DefaultToolCard` remains the
 * generic collapsible shell for now. The AI Elements `<Tool>` wrapper
 * is adopted by `ContextToolGroup` (the grouped-context shell).
 * `DefaultToolCard`'s internal collapsible can be migrated to
 * `<Tool>` in a follow-up without changing `ToolCallView`'s public
 * API or any callsite.
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

  if (isTaskToolCall(tool.name)) {
    return (
      <TaskToolCard
        tool={tool}
        forceExpanded={forceExpanded}
        onNavigateToSession={onNavigateToSession}
      />
    );
  }

  if (isBackgroundSubagentToolCall(tool.name)) {
    return (
      <BackgroundSubagentToolCard
        tool={tool}
        forceExpanded={forceExpanded}
        onNavigateToSession={onNavigateToSession}
      />
    );
  }

  // Specialized cards for the most common tools. Order: cheap classifier
  // hits first (bash/grep/glob are distinguishable by name alone), then
  // webfetch/write. TodoRead goes last because `classifyTool` lumps both
  // todowrite and todoread into `'todo'`; `isTodoReadToolCall` re-narrows
  // on the name. TodoWrite has already been dispatched above, so reaching
  // this branch with a 'todo' tool implies todoread.
  if (isBashToolCall(tool.name)) {
    return <BashToolCard tool={tool} forceExpanded={forceExpanded} />;
  }

  if (isGrepToolCall(tool.name)) {
    return <GrepToolCard tool={tool} forceExpanded={forceExpanded} />;
  }

  if (isGlobToolCall(tool.name)) {
    return <GlobToolCard tool={tool} forceExpanded={forceExpanded} />;
  }

  if (isWebFetchToolCall(tool.name)) {
    return <WebFetchToolCard tool={tool} forceExpanded={forceExpanded} />;
  }

  if (isWriteToolCall(tool.name)) {
    return <WriteToolCard tool={tool} forceExpanded={forceExpanded} />;
  }

  if (isTodoReadToolCall(tool.name)) {
    return <TodoReadToolCard tool={tool} forceExpanded={forceExpanded} />;
  }

  if (isLspToolCall(tool.name)) {
    return <LspToolCard tool={tool} forceExpanded={forceExpanded} />;
  }

  return <DefaultToolCard tool={tool} forceExpanded={forceExpanded} />;
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
  // Play the enter animation once per tool ID. On first render we mark
  // the id as animated so subsequent remounts (virtualization) don't
  // replay the fade.
  const shouldAnimate = !animatedToolIds.has(tool.id);
  if (shouldAnimate) animatedToolIds.add(tool.id);

  return (
    <div
      className={shouldAnimate ? 'anim-tool-enter' : undefined}
      data-component="tool-card-shell"
      data-tool-category={getToolCategory(tool.name)}
      data-tool-status={tool.status ?? 'completed'}
    >
      {resolveToolCard(tool, forceExpanded, onNavigateToSession)}
    </div>
  );
});

export default ToolCallView;
