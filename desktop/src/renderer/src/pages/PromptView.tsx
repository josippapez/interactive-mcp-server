import { useEffect, useRef, useState } from 'react';
import type {
  PromptData,
  ChannelMessage,
  Attachment,
  SessionStatus,
  SessionNode,
} from '../types';
import PromptMessage from '../components/prompt/PromptMessage';
import ChatHistoryView from '../components/prompt/ChatHistoryView';
import AgentStatusBar from '../components/prompt/AgentStatusBar';
import ChannelSidebar from '../components/prompt/ChannelSidebar';
import ChannelHeader from '../components/prompt/ChannelHeader';
import ChannelComposer from '../components/prompt/ChannelComposer';
import { resolveSessionActionTarget } from '../hooks/remove-session-target';

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
  onSubmit: (answer: string, attachments?: Attachment[]) => void;
  onSelectOption: (option: string) => void;
  onDismissStatus: (connectionId: string, timestamp: Date) => void;
  onDismissSession: (connectionId: string) => void;
  onQueueSessionMessage: (
    sessionId: string,
    message: string,
    attachments?: Attachment[],
  ) => void;
  onClearMessages: (sessionId: string) => void;
  onRemoveSession: (sessionId: string) => void;
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
  onSubmit,
  onSelectOption,
  onDismissStatus,
  onDismissSession,
  onQueueSessionMessage,
  onClearMessages,
  onRemoveSession,
}: Props): React.ReactElement {
  const chatEndRef = useRef<HTMLDivElement>(null);
  const hasHistory = channelMessages.length > 0;
  const idle = !prompt && !activeSession && !hasHistory;

  // Countdown timer — resets whenever a new prompt arrives
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!prompt) {
      setSecondsLeft(null);
      return;
    }
    setSecondsLeft(prompt.timeoutSeconds);
    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev === null || prev <= 0) return 0;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [prompt?.id]); // re-run only when prompt identity changes

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
      <div className="flex-1 flex flex-col min-w-0">
        {activeConnectionId ? (
          <>
            <ChannelHeader
              label={sessionChannel?.label ?? activeConnectionId}
              promptActive={Boolean(prompt)}
              onClearMessages={() =>
                sessionActionTarget && onClearMessages(sessionActionTarget)
              }
              onRemoveSession={() =>
                sessionActionTarget && onRemoveSession(sessionActionTarget)
              }
              onDismissSession={() =>
                sessionActionTarget && onDismissSession(sessionActionTarget)
              }
            />

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

              {!idle && (
                <ChatHistoryView
                  messages={channelMessages}
                  chatEndRef={chatEndRef}
                  activePromptId={activePromptId}
                  predefinedOptions={prompt?.predefinedOptions}
                  onSelectOption={onSelectOption}
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

            {sessionChannel && (
              <AgentStatusBar
                sessionChannel={sessionChannel}
                sessionStatuses={sessionStatuses}
                connectionId={activeConnectionId}
                onDismissStatus={onDismissStatus}
              />
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
                placeholder="Message the agent… (⌘+Enter to queue)"
                onSubmit={(text, attachments) => {
                  if (sessionChannel)
                    onQueueSessionMessage(
                      sessionChannel.sessionId,
                      text,
                      attachments,
                    );
                }}
              />
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[var(--color-text-muted)]">
            No channels yet.
          </div>
        )}
      </div>
    </div>
  );
}
