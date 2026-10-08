import { memo, useMemo, useRef, type MouseEvent } from 'react';
import { ArrowUpRight, Bot, Circle, PanelRightClose, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { Attachment, SessionNode } from '../../types';
import type { ChatTextSize } from './chat-text-size';
import ChannelComposer from './ChannelComposer';
import ChatHistoryView from './ChatHistoryView';
import { ContextUsageBar } from './ContextUsageBar';
import QuestionDock from './QuestionDock';
import { usePromptModelState } from '../../pages/prompt/usePromptModelState';
import { usePromptConnectionData } from '../../pages/prompt/usePromptConnectionData';
import {
  getPromptComposerBaseDirectory,
  getPromptPlaceholder,
  getQueueComposerBaseDirectory,
} from '../../pages/prompt/prompt-utils';
import { resolveSessionRepositoryRoot } from '../../pages/prompt/session-repository-root';
import { resolveDisplayedSessionModel } from '../../pages/prompt/session-model-display';
import { useResizablePanel } from '../../hooks/useResizablePanel';

type SubagentSessionPaneProps = {
  connections: Map<string, SessionNode>;
  sessionIds: readonly string[];
  activeSessionId: string;
  onActiveSessionChange: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onClosePane: () => void;
  onOpenInMain: (sessionId: string) => void;
  onOpenSessionTab: (sessionId: string) => void;
  onSubmitForSession: (
    sessionId: string,
    answer: string,
    attachments?: Attachment[],
  ) => void;
  onSelectOptionForSession: (sessionId: string, option: string) => void;
  onQueueSessionMessageForSession: (
    sessionId: string,
    message: string,
    attachments?: Attachment[],
  ) => void;
  onInjectWithReplyForSession?: (
    sessionId: string,
    message: string,
    attachments?: Attachment[],
    modelOverride?: {
      providerId: string;
      modelId: string;
      variant?: string;
    },
    agent?: string,
  ) => void;
  onToggleDocContextForSession: (sessionId: string) => void;
  onReplyQuestion: (
    requestId: string,
    answers: string[][],
    sessionID: string,
  ) => void;
  onRejectQuestion: (requestId: string, sessionID: string) => void;
  noReply: boolean;
  onNoReplyChange: (value: boolean) => void;
  commandPaletteOpen: boolean;
  onCommandPaletteChange: (open: boolean) => void;
  expandAllTools: boolean;
  toolAutoExpandExclusions: string[];
  showThinking: boolean;
  chatTextSize: ChatTextSize;
};

function formatStatus(node: SessionNode, isBusy: boolean): string {
  if (node.prompt) {
    return 'Awaiting reply';
  }

  if (node.pendingQuestions.length > 0) {
    return 'Question pending';
  }

  if (isBusy) {
    return 'Busy';
  }

  return node.sessionStatuses.at(-1)?.status ?? 'Idle';
}

function SessionTabContent({
  connections,
  sessionId,
  node,
  onOpenInMain,
  onOpenSessionTab,
  onSubmitForSession,
  onSelectOptionForSession,
  onQueueSessionMessageForSession,
  onInjectWithReplyForSession,
  onToggleDocContextForSession,
  onReplyQuestion,
  onRejectQuestion,
  noReply,
  onNoReplyChange,
  commandPaletteOpen,
  onCommandPaletteChange,
  expandAllTools,
  toolAutoExpandExclusions,
  showThinking,
  chatTextSize,
}: Omit<
  SubagentSessionPaneProps,
  | 'sessionIds'
  | 'activeSessionId'
  | 'onActiveSessionChange'
  | 'onCloseSession'
  | 'onClosePane'
> & {
  sessionId: string;
  node: SessionNode;
}): React.ReactElement {
  const chatEndRef = useRef<HTMLDivElement>(null);
  const providerSessionId =
    node.providerSessionId ?? (sessionId.startsWith('ses_') ? sessionId : null);
  const isOpenCodeSession =
    node.providerType === 'opencode' || providerSessionId !== null;
  const sessionBaseDirectory = resolveSessionRepositoryRoot(node, connections);
  const {
    conversationMessages,
    conversationAvailable,
    conversationIsSeeding,
    currentModelId,
    currentProviderId,
    currentVariant,
    sessionModelSelection,
    runningContextWindow,
    sessionBusy,
  } = usePromptConnectionData({
    providerSessionId,
    isOpenCodeSession,
    sessionBaseDirectory,
    sessionStatuses: node.sessionStatuses,
  });
  const { currentModelOverride, handleModelSelect } =
    usePromptModelState(providerSessionId);
  const displayedSessionModel = resolveDisplayedSessionModel({
    hasOverride: Boolean(sessionModelSelection.currentModelOverride),
    runningModel: {
      modelId: currentModelId,
      providerId: currentProviderId,
      variant: currentVariant,
    },
    selectedModel: {
      modelId: sessionModelSelection.modelId,
      providerId: sessionModelSelection.providerId,
      variant: sessionModelSelection.variant,
    },
  });
  const contextUsageSessionId =
    providerSessionId ??
    (node.sessionChannel?.sessionId?.startsWith('ses_')
      ? node.sessionChannel.sessionId
      : null);
  const promptBaseDirectory = getPromptComposerBaseDirectory(
    node.prompt,
    sessionId,
    connections,
  );
  const queueBaseDirectory = getQueueComposerBaseDirectory(
    sessionId,
    connections,
  );
  const promptActive = Boolean(node.prompt);
  const composerBaseDirectory =
    sessionBaseDirectory ??
    (promptActive ? promptBaseDirectory : queueBaseDirectory);
  const status = formatStatus(node, sessionBusy && isOpenCodeSession);
  const modelLabel = useMemo(() => {
    if (!displayedSessionModel.modelId) {
      return null;
    }
    return displayedSessionModel.variant
      ? `${displayedSessionModel.modelId} / ${displayedSessionModel.variant}`
      : displayedSessionModel.modelId;
  }, [displayedSessionModel.modelId, displayedSessionModel.variant]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-[var(--border-weaker-base)] px-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[var(--color-text)]">
            {node.title}
          </div>
          <div className="flex min-w-0 items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
            <span className="inline-flex items-center gap-1">
              <Circle
                className={cn(
                  'h-2.5 w-2.5 fill-current stroke-none',
                  sessionBusy
                    ? 'text-[var(--color-agent)]'
                    : 'text-[var(--color-text-faint)]',
                )}
                aria-hidden="true"
              />
              {status}
            </span>
            {modelLabel && <span className="truncate">{modelLabel}</span>}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
          onClick={() => onOpenInMain(sessionId)}
        >
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          Main
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <ChatHistoryView
          messages={node.channelMessages}
          chatEndRef={chatEndRef}
          activePromptId={node.prompt?.id ?? null}
          predefinedOptions={node.prompt?.predefinedOptions}
          onSelectOption={(option) =>
            onSelectOptionForSession(sessionId, option)
          }
          lastReadMessageId={node.lastReadMessageId}
          conversationMessages={conversationMessages}
          showConversation={isOpenCodeSession && conversationAvailable}
          isSeeding={conversationIsSeeding}
          expandAllTools={expandAllTools}
          toolAutoExpandExclusions={toolAutoExpandExclusions}
          onNavigateToSession={onOpenSessionTab}
          showThinking={showThinking}
          chatTextSize={chatTextSize}
          isBusy={sessionBusy && isOpenCodeSession}
          channelId={sessionId}
        />
      </div>

      {contextUsageSessionId && (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-alt)]/40 px-2.5 py-1">
          <ContextUsageBar
            sessionId={contextUsageSessionId}
            modelContextWindow={
              runningContextWindow ?? sessionModelSelection.contextWindow
            }
            isBusy={sessionBusy && isOpenCodeSession}
          />
        </div>
      )}

      {node.pendingQuestions[0] && (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-alt)]/30 p-2">
          <QuestionDock
            question={node.pendingQuestions[0]}
            onReply={onReplyQuestion}
            onReject={onRejectQuestion}
            fill
          />
        </div>
      )}

      <div className="border-t border-[var(--color-border)] bg-[var(--color-bg)]">
        {promptActive ? (
          <ChannelComposer
            enabled
            baseDirectory={composerBaseDirectory ?? undefined}
            placeholder={getPromptPlaceholder(
              node.prompt,
              sessionId,
              connections,
            )}
            onSubmit={(text, attachments) =>
              onSubmitForSession(sessionId, text, attachments)
            }
            sessionId={providerSessionId}
            providerSessionId={providerSessionId}
            commandPaletteOpen={commandPaletteOpen}
            onCommandPaletteChange={onCommandPaletteChange}
            modelId={displayedSessionModel.modelId ?? undefined}
            providerId={displayedSessionModel.providerId ?? undefined}
            variant={displayedSessionModel.variant ?? undefined}
            onModelSelect={handleModelSelect}
            isOpenCodeSession={isOpenCodeSession}
            connectionId={node.connectionId ?? sessionId}
            docContextEnabled={node.docContextEnabled !== false}
            onToggleDocContext={() => onToggleDocContextForSession(sessionId)}
          />
        ) : (
          <ChannelComposer
            enabled={Boolean(node.sessionChannel) || Boolean(providerSessionId)}
            submitLabel="Queue"
            baseDirectory={composerBaseDirectory ?? undefined}
            placeholder="Message the agent… (/ for commands, ⌘+Enter to queue, ↵ to trigger reply)"
            onSubmit={(text, attachments) =>
              onQueueSessionMessageForSession(sessionId, text, attachments)
            }
            showReplyButton={Boolean(providerSessionId) && isOpenCodeSession}
            onSubmitWithReply={(text, attachments, agent) => {
              onInjectWithReplyForSession?.(
                sessionId,
                text,
                attachments,
                currentModelOverride ?? undefined,
                agent,
              );
            }}
            noReply={noReply}
            onNoReplyChange={onNoReplyChange}
            sessionId={providerSessionId}
            providerSessionId={providerSessionId}
            commandPaletteOpen={commandPaletteOpen}
            onCommandPaletteChange={onCommandPaletteChange}
            modelId={displayedSessionModel.modelId ?? undefined}
            providerId={displayedSessionModel.providerId ?? undefined}
            variant={displayedSessionModel.variant ?? undefined}
            onModelSelect={handleModelSelect}
            isOpenCodeSession={isOpenCodeSession}
            connectionId={node.connectionId ?? sessionId}
            docContextEnabled={node.docContextEnabled !== false}
            onToggleDocContext={() => onToggleDocContextForSession(sessionId)}
          />
        )}
      </div>
    </div>
  );
}

function SubagentSessionPane({
  connections,
  sessionIds,
  activeSessionId,
  onActiveSessionChange,
  onCloseSession,
  onClosePane,
  ...rest
}: SubagentSessionPaneProps): React.ReactElement {
  const activeNode = connections.get(activeSessionId) ?? null;
  const { width, handleRef, isResizing } = useResizablePanel({
    storageKey: 'prompt-subagent-pane-width',
    defaultWidth: 420,
    minWidth: 320,
    maxWidth: 720,
    edge: 'left',
  });

  return (
    <aside
      aria-label="Subagent sessions"
      style={{ width }}
      className={cn(
        'relative hidden min-h-0 shrink-0 flex-col border-l border-[var(--border-weaker-base)] bg-[var(--background-base)] md:flex',
        isResizing && 'select-none',
      )}
    >
      <div
        ref={handleRef}
        className={cn(
          'absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize',
          'hover:bg-primary/30 transition-colors',
          isResizing && 'bg-primary/40',
        )}
        aria-hidden="true"
      />

      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-[var(--border-weaker-base)] px-3">
        <div className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
          <Bot
            className="h-4 w-4 text-[var(--color-agent)]"
            aria-hidden="true"
          />
          Subagents
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-[var(--color-text-faint)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
          aria-label="Close subagent pane"
          title="Close subagent pane"
          onClick={onClosePane}
        >
          <PanelRightClose className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <Tabs
        value={activeSessionId}
        onValueChange={onActiveSessionChange}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="shrink-0 border-b border-[var(--border-weaker-base)] px-2">
          <TabsList
            variant="line"
            className="h-10 w-full justify-start gap-1 overflow-x-auto border-0"
          >
            {sessionIds.map((sessionId) => {
              const node = connections.get(sessionId);
              const label = node?.title ?? sessionId;
              return (
                <div key={sessionId} className="flex min-w-0 items-center">
                  <TabsTrigger
                    value={sessionId}
                    className="h-10 max-w-[180px] gap-1.5 px-2 text-xs data-active:border-[var(--color-agent)] data-active:text-[var(--color-text)]"
                    title={label}
                  >
                    <span
                      className={cn(
                        'h-2 w-2 shrink-0 rounded-full',
                        node?.prompt || node?.pendingQuestions.length
                          ? 'bg-amber-500'
                          : 'bg-[var(--color-agent)]',
                      )}
                      aria-hidden="true"
                    />
                    <span className="truncate">{label}</span>
                  </TabsTrigger>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-[var(--color-text-faint)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
                    aria-label={`Close ${label}`}
                    title={`Close ${label}`}
                    onClick={(event: MouseEvent<HTMLButtonElement>) => {
                      event.stopPropagation();
                      onCloseSession(sessionId);
                    }}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              );
            })}
          </TabsList>
        </div>

        {activeNode && (
          <TabsContent
            key={activeSessionId}
            value={activeSessionId}
            className="min-h-0 flex-1 data-[state=inactive]:hidden"
          >
            <SessionTabContent
              {...rest}
              connections={connections}
              sessionId={activeSessionId}
              node={activeNode}
            />
          </TabsContent>
        )}
      </Tabs>
    </aside>
  );
}

export default memo(SubagentSessionPane);
