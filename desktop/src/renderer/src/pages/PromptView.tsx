import { useEffect, useRef, useState } from 'react';
import type {
  PromptData,
  ChannelMessage,
  Attachment,
  SessionStatus,
  SessionNode,
  PendingPermission,
} from '../types';
import PromptMessage from '../components/prompt/PromptMessage';
import ChatHistoryView from '../components/prompt/ChatHistoryView';
import AgentStatusBar from '../components/prompt/AgentStatusBar';
import ChannelSidebar from '../components/prompt/ChannelSidebar';
import ChannelHeader from '../components/prompt/ChannelHeader';
import ChannelComposer from '../components/prompt/ChannelComposer';
import PermissionPrompt from '../components/prompt/PermissionPrompt';
import TodoList from '../components/prompt/TodoList';
import { resolveSessionActionTarget } from '../hooks/remove-session-target';
import { useTodos } from '../hooks/useTodos';
import { useVcsInfo } from '../hooks/useVcsInfo';
import { useConversation } from '../hooks/useConversation';
import { useSessionModelId } from '../hooks/useSessionModelId';
import { useSessionStatus } from '../hooks/useSessionStatus';

type Props = {
  connections: Map<string, SessionNode>;
  activeConnectionId: string | null;
  onSelectConnection: (connectionId: string) => void;
  prompt: PromptData | null;
  activeSession: { id: string; title: string } | null;
  channelMessages: ChannelMessage[];
  connectionId: string | null;
  sessionChannel: { sessionId: string; label?: string } | null;
  sessionStatuses: SessionStatus[];
  pendingPermissions: PendingPermission[];
  docContextEnabled: boolean;
  onSubmit: (answer: string, attachments?: Attachment[]) => void;
  onSelectOption: (option: string) => void;
  onDismissStatus: (connectionId: string, timestamp: Date) => void;
  onDismissSession: (connectionId: string) => void;
  onQueueSessionMessage: (
    sessionId: string,
    message: string,
    attachments?: Attachment[],
  ) => void;
  /** Called when "Send with Reply" is clicked (noReply=false) — triggers agent response */
  onInjectWithReply?: (
    sessionId: string,
    message: string,
    attachments?: Attachment[],
  ) => void;
  onClearMessages: (sessionId: string) => void;
  onRemoveSession: (sessionId: string) => Promise<boolean>;
  onToggleDocContext: () => void;
};

export default function PromptView({
  connections,
  activeConnectionId,
  onSelectConnection,
  prompt,
  activeSession,
  channelMessages,
  connectionId,
  sessionChannel,
  sessionStatuses,
  pendingPermissions,
  docContextEnabled,
  onSubmit,
  onSelectOption,
  onDismissStatus,
  onDismissSession,
  onQueueSessionMessage,
  onInjectWithReply,
  onClearMessages,
  onRemoveSession,
  onToggleDocContext,
}: Props): React.ReactElement {
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Get the active node's OpenCode session ID for todos
  const activeNode = activeConnectionId
    ? connections.get(activeConnectionId)
    : null;
  const openCodeSessionId = activeNode?.openCodeSessionId ?? null;

  // Fetch todos for the active OpenCode session
  const {
    todos,
    isLoading: todosLoading,
    error: todosError,
    refresh: refreshTodos,
  } = useTodos(openCodeSessionId);

  // Fetch VCS info from the OpenCode server (uses dedicated /vcs endpoint)
  const { vcsInfo } = useVcsInfo(Boolean(openCodeSessionId));

  // Fetch OpenCode conversation messages for mirroring
  const isOpenCodeSession = activeNode?.providerType === 'opencode';
  const { messages: conversationMessages, isAvailable: conversationAvailable } =
    useConversation(
      isOpenCodeSession ? openCodeSessionId : null,
      isOpenCodeSession,
    );

  // Fetch the model ID for the session (one-time fetch, not polling)
  const currentModelId = useSessionModelId(
    openCodeSessionId,
    isOpenCodeSession,
  );

  // Fetch session status (busy/idle) for the active OpenCode session
  const { getStatus } = useSessionStatus(isOpenCodeSession);
  const sessionBusy =
    openCodeSessionId && isOpenCodeSession
      ? getStatus(openCodeSessionId) === 'busy'
      : false;

  // Calculate idle state after fetching conversation messages
  const hasHistory = channelMessages.length > 0;
  const hasConversation = conversationMessages.length > 0;
  const idle = !prompt && !activeSession && !hasHistory && !hasConversation;

  // Countdown timer — clock-based, survives channel tab switches.
  // expiresAtRef stores the resolved expiry timestamp keyed by prompt ID so
  // that when prompt goes null (switching channels) and comes back with the
  // same ID, we use the original expiry rather than resetting.
  const expiresAtRef = useRef<Map<string, number>>(new Map());
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  // Error state for failed session removal
  const [removeError, setRemoveError] = useState<string | null>(null);

  // noReply toggle state - controls whether messages trigger agent response
  // Loaded from settings on mount, persisted on change
  const [noReply, setNoReply] = useState(true);

  // Collapsible right sidebar (tasks panel)
  const [tasksSidebarCollapsed, setTasksSidebarCollapsed] = useState(false);

  // Toggle for expanding all tool calls in the conversation view
  // Loaded from settings on mount, persisted on change
  const [expandAllTools, setExpandAllTools] = useState(false);

  // Tool exclusions from settings (tools that should NOT auto-expand)
  const [toolAutoExpandExclusions, setToolAutoExpandExclusions] = useState<
    string[]
  >([]);

  // Load settings on mount (noReply, expandAllTools, toolAutoExpandExclusions)
  useEffect(() => {
    const loadSettings = async () => {
      const settings = await window.api.getSettings();
      setNoReply(settings.defaultNoReply ?? true);
      setExpandAllTools(settings.defaultExpandAllTools ?? false);
      setToolAutoExpandExclusions(settings.toolAutoExpandExclusions ?? []);
    };
    loadSettings();
  }, []);

  // Persist noReply toggle changes to settings
  const handleNoReplyChange = async (value: boolean) => {
    setNoReply(value);
    const settings = await window.api.getSettings();
    await window.api.saveSettings({ ...settings, defaultNoReply: value });
  };

  // Persist expandAllTools toggle changes to settings
  const handleExpandAllToolsChange = async (value: boolean) => {
    setExpandAllTools(value);
    const settings = await window.api.getSettings();
    await window.api.saveSettings({
      ...settings,
      defaultExpandAllTools: value,
    });
  };

  // Poll for tool exclusions changes (in case user updates from SettingsView)
  useEffect(() => {
    const loadExclusions = async () => {
      const settings = await window.api.getSettings();
      setToolAutoExpandExclusions(settings.toolAutoExpandExclusions ?? []);
    };
    // Poll for settings changes (in case user updates from SettingsView)
    const interval = setInterval(loadExclusions, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!prompt) {
      setSecondsLeft(null);
      return;
    }

    // Resolve expiry: prefer already-recorded value (survives null gaps),
    // then use main-process-stamped expiresAt, then derive from timeoutSeconds
    // (fallback for builds that pre-date the expiresAt field).
    let expiry = expiresAtRef.current.get(prompt.id);
    if (!expiry) {
      if (prompt.expiresAt) {
        expiry = prompt.expiresAt;
      } else if (prompt.timeoutSeconds) {
        expiry = Date.now() + prompt.timeoutSeconds * 1000;
      }
      if (expiry) {
        expiresAtRef.current.set(prompt.id, expiry);
      }
    }

    if (!expiry) {
      setSecondsLeft(null);
      return;
    }

    const resolvedExpiry = expiry;
    const computeRemaining = (): number =>
      Math.max(0, Math.round((resolvedExpiry - Date.now()) / 1000));

    setSecondsLeft(computeRemaining());

    const interval = setInterval(() => {
      setSecondsLeft(computeRemaining());
    }, 1000);
    return () => clearInterval(interval);
  }, [prompt?.id]); // re-run only when prompt identity changes

  // Clear remove error whenever the active session changes
  useEffect(() => {
    setRemoveError(null);
  }, [activeConnectionId]);

  // ID of the last question message that is still awaiting a response
  const activePromptId = prompt
    ? ([...channelMessages].reverse().find((m) => m.kind === 'question')?.id ??
      null)
    : null;

  const sessionActionTarget = activeConnectionId
    ? resolveSessionActionTarget({
        requestedId: activeConnectionId,
        connectionId,
        sessionChannelId: sessionChannel?.sessionId ?? null,
      })
    : null;

  const handleRemoveSession = async () => {
    if (!sessionActionTarget) return;
    const ok = await onRemoveSession(sessionActionTarget);
    if (!ok) {
      setRemoveError(
        'Failed to remove session. The channel data was cleaned up but the agent transport may still be active.',
      );
    } else {
      setRemoveError(null);
    }
  };

  const handleAbortSession = async () => {
    if (!openCodeSessionId) return;
    const result = await window.api.abortSession(openCodeSessionId);
    if (!result.success) {
      console.warn('[PromptView] Failed to abort session:', result.error);
    }
  };

  // Can abort if this is an OpenCode session
  const canAbort = Boolean(openCodeSessionId);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [channelMessages]);

  return (
    <div className="flex h-full">
      <ChannelSidebar
        connections={connections}
        activeConnectionId={activeConnectionId}
        onSelect={onSelectConnection}
      />
      <div className="flex-1 flex min-w-0">
        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0">
          {activeConnectionId ? (
            <>
              <ChannelHeader
                label={sessionChannel?.label ?? activeConnectionId}
                promptActive={Boolean(prompt)}
                onClearMessages={() =>
                  sessionActionTarget && onClearMessages(sessionActionTarget)
                }
                onRemoveSession={handleRemoveSession}
                onDismissSession={() =>
                  sessionActionTarget && onDismissSession(sessionActionTarget)
                }
                onAbortSession={handleAbortSession}
                canAbort={canAbort}
                vcsInfo={vcsInfo}
                modelId={currentModelId}
                expandAllTools={expandAllTools}
                onToggleExpandAllTools={() =>
                  handleExpandAllToolsChange(!expandAllTools)
                }
              />

              {removeError && (
                <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-error)]/20 bg-[var(--color-error)]/10 text-xs text-[var(--color-error)]">
                  <span>{removeError}</span>
                  <button
                    type="button"
                    onClick={() => setRemoveError(null)}
                    className="ml-3 text-[var(--color-error)]/60 hover:text-[var(--color-error)] transition-colors cursor-pointer"
                    aria-label="Dismiss error"
                  >
                    ✕
                  </button>
                </div>
              )}

              <div className="flex-1 overflow-hidden flex flex-col">
                {activeSession && (
                  <div className="flex items-center justify-between px-4 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-xs text-[var(--color-text-muted)]">
                        session:{' '}
                        <span className="text-[var(--color-text-muted)]">
                          {activeSession.title}
                        </span>
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        connectionId &&
                        window.api.forceTerminateChat(connectionId)
                      }
                      className="px-2 py-0.5 text-[10px] rounded-sm bg-[#331111] text-[var(--color-error)] hover:bg-[#441111] hover:text-[#ff4444] transition-colors cursor-pointer border border-[#442222]"
                      title="Force terminate this conversation"
                    >
                      ✕ Terminate
                    </button>
                  </div>
                )}

                {prompt && !activeSession && (
                  <PromptMessage prompt={prompt} secondsLeft={secondsLeft} />
                )}

                {/* Unified chat history with optional conversation messages */}
                {!idle && (
                  <ChatHistoryView
                    messages={channelMessages}
                    chatEndRef={chatEndRef}
                    activePromptId={activePromptId}
                    predefinedOptions={prompt?.predefinedOptions}
                    onSelectOption={onSelectOption}
                    lastReadMessageId={activeNode?.lastReadMessageId}
                    conversationMessages={conversationMessages}
                    showConversation={
                      isOpenCodeSession && conversationAvailable
                    }
                    expandAllTools={expandAllTools}
                    toolAutoExpandExclusions={toolAutoExpandExclusions}
                  />
                )}

                {idle && (
                  <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)] gap-2">
                    <div className="flex items-center gap-2 text-lg">
                      <span className="text-[var(--color-agent)]">❯</span>
                      <span className="cursor-blink text-[var(--color-text-muted)]">
                        _
                      </span>
                    </div>
                    <p className="text-sm text-[var(--color-text-muted)]">
                      Waiting for prompt from MCP client…
                    </p>
                  </div>
                )}
              </div>

              {pendingPermissions.length > 0 && (
                <PermissionPrompt permissions={pendingPermissions} />
              )}

              {/* Agent status bar + docs toggle on the same row */}
              <div className="flex items-center justify-between px-3 py-1 border-t border-[var(--color-border)] bg-[var(--color-surface-alt)]">
                {sessionChannel ? (
                  <AgentStatusBar
                    sessionChannel={sessionChannel}
                    sessionStatuses={sessionStatuses}
                    connectionId={activeConnectionId}
                    onDismissStatus={onDismissStatus}
                    inline
                  />
                ) : (
                  <div />
                )}
                <button
                  type="button"
                  onClick={onToggleDocContext}
                  className={`flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-sm border transition-colors cursor-pointer select-none shrink-0 ${
                    docContextEnabled
                      ? 'border-[var(--color-agent)]/40 text-[var(--color-agent)] bg-[var(--color-agent)]/10 hover:bg-[var(--color-agent)]/20'
                      : 'border-[var(--color-border)] text-[var(--color-text-faint)] bg-transparent hover:text-[var(--color-text-muted)]'
                  }`}
                  title={
                    docContextEnabled
                      ? 'Doc context injection enabled — click to disable'
                      : 'Doc context injection disabled — click to enable'
                  }
                >
                  <span>{docContextEnabled ? '⬡' : '⬡'}</span>
                  <span>docs {docContextEnabled ? 'on' : 'off'}</span>
                </button>
              </div>

              {/* Busy indicator - shows when agent is working */}
              {sessionBusy && isOpenCodeSession && (
                <div className="flex items-center gap-2 px-3 py-1.5 border-t border-[var(--color-border)] bg-[var(--color-surface-alt)]">
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-user)] animate-pulse" />
                    <span className="text-[10px] text-[var(--color-text-muted)]">
                      Agent is working...
                    </span>
                  </span>
                </div>
              )}

              {prompt ? (
                <ChannelComposer
                  enabled
                  baseDirectory={
                    prompt.baseDirectory ??
                    (activeConnectionId
                      ? (connections.get(activeConnectionId)?.baseDirectory ??
                        connections.get(activeConnectionId)?.directory ??
                        undefined)
                      : undefined)
                  }
                  placeholder={
                    prompt.baseDirectory ||
                    connections.get(activeConnectionId ?? '')?.baseDirectory ||
                    connections.get(activeConnectionId ?? '')?.directory
                      ? 'Type your answer… (# or @ for files, ⌘+Enter to send)'
                      : 'Type your answer… (⌘+Enter to send)'
                  }
                  onSubmit={onSubmit}
                />
              ) : (
                <ChannelComposer
                  enabled={Boolean(sessionChannel)}
                  submitLabel="Queue"
                  baseDirectory={(() => {
                    const node = activeConnectionId
                      ? connections.get(activeConnectionId)
                      : undefined;
                    return node?.baseDirectory ?? node?.directory ?? undefined;
                  })()}
                  placeholder="Message the agent… (⌘+Enter to queue, ↵ to trigger reply)"
                  onSubmit={(text, attachments) => {
                    if (sessionChannel)
                      onQueueSessionMessage(
                        sessionChannel.sessionId,
                        text,
                        attachments,
                      );
                  }}
                  showReplyButton={
                    Boolean(openCodeSessionId) &&
                    activeNode?.providerType === 'opencode'
                  }
                  onSubmitWithReply={(text, attachments) => {
                    if (sessionChannel && onInjectWithReply)
                      onInjectWithReply(
                        sessionChannel.sessionId,
                        text,
                        attachments,
                      );
                  }}
                  noReply={noReply}
                  onNoReplyChange={handleNoReplyChange}
                />
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[var(--color-text-muted)]">
              No channels yet.
            </div>
          )}
        </div>

        {/* Right sidebar - Todo list for OpenCode sessions only */}
        {activeConnectionId &&
          openCodeSessionId &&
          activeNode?.providerType === 'opencode' && (
            <div
              className={`border-l border-[var(--color-border)] bg-[var(--color-surface-alt)] flex flex-col overflow-hidden shrink-0 transition-[width] duration-200 ease-in-out ${
                tasksSidebarCollapsed ? 'w-8' : 'w-72'
              }`}
            >
              {tasksSidebarCollapsed ? (
                <button
                  onClick={() => setTasksSidebarCollapsed(false)}
                  className="flex flex-col items-center gap-2 py-3 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors h-full"
                  title="Expand tasks panel"
                >
                  <span className="text-[10px]">◀</span>
                  <span
                    className="text-[9px] font-medium uppercase tracking-wide"
                    style={{ writingMode: 'vertical-rl' }}
                  >
                    Tasks
                  </span>
                  {(todos.filter(
                    (t) => t.status === 'pending' || t.status === 'in_progress',
                  ).length > 0 && (
                    <span className="px-1 py-0.5 rounded-full bg-[var(--color-surface-alt)] text-[8px] text-[var(--color-user)]">
                      {
                        todos.filter(
                          (t) =>
                            t.status === 'pending' ||
                            t.status === 'in_progress',
                        ).length
                      }
                    </span>
                  )) ||
                    null}
                </button>
              ) : (
                <>
                  {/* Collapse button in header area */}
                  <div className="flex items-center justify-end px-2 py-1 border-b border-[var(--color-border)]">
                    <button
                      onClick={() => setTasksSidebarCollapsed(true)}
                      className="p-1 text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded transition-colors"
                      title="Collapse tasks panel"
                    >
                      <span className="text-[10px]">▶</span>
                    </button>
                  </div>
                  <TodoList
                    todos={todos}
                    isLoading={todosLoading}
                    error={todosError}
                    onRefresh={refreshTodos}
                  />
                </>
              )}
            </div>
          )}
      </div>
    </div>
  );
}
