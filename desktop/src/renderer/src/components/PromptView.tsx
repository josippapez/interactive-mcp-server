import { useEffect, useRef } from 'react';
import type {
  PromptData,
  ChannelMessage,
  Attachment,
  SessionStatus,
  ConnectionState,
} from '../types';
import PromptMessage from './prompt/PromptMessage';
import ChatHistoryView from './prompt/ChatHistoryView';
import SessionChannelBar from './prompt/SessionChannelBar';
import ChannelSidebar from './prompt/ChannelSidebar';
import ChannelHeader from './prompt/ChannelHeader';
import ChannelComposer from './prompt/ChannelComposer';

type Props = {
  connections: Map<string, ConnectionState>;
  activeConnectionId: string | null;
  onSelectConnection: (connectionId: string) => void;
  prompt: PromptData | null;
  activeSession: { id: string; title: string } | null;
  channelMessages: ChannelMessage[];
  connectionId: string | null;
  sessionChannel: { sessionId: string; label?: string } | null;
  sessionStatuses: SessionStatus[];
  isRestored?: boolean;
  onSubmit: (answer: string, attachments?: Attachment[]) => void;
  onSelectOption: (option: string) => void;
  onDismissStatus: (connectionId: string, timestamp: Date) => void;
  onDismissSession: (connectionId: string) => void;
  onQueueSessionMessage: (sessionId: string, message: string) => void;
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
  isRestored = false,
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
              onClearMessages={() => onClearMessages(activeConnectionId)}
              onRemoveSession={() => onRemoveSession(activeConnectionId)}
              onDismissSession={() => onDismissSession(activeConnectionId)}
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

              {hasHistory && (
                <ChatHistoryView
                  messages={channelMessages}
                  chatEndRef={chatEndRef}
                />
              )}

              {prompt && !activeSession && (
                <PromptMessage prompt={prompt} secondsLeft={null} />
              )}

              {isRestored && !prompt && !activeSession && (
                <div className="flex flex-col items-center justify-center flex-1 gap-2 text-[var(--color-text-muted)]">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
                    <span className="text-sm">
                      Awaiting agent reconnection…
                    </span>
                  </div>
                </div>
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
              <SessionChannelBar
                sessionChannel={sessionChannel}
                sessionStatuses={sessionStatuses}
                connectionId={activeConnectionId}
                onDismissStatus={onDismissStatus}
              />
            )}

            {prompt ? (
              <ChannelComposer
                enabled
                baseDirectory={prompt.baseDirectory}
                placeholder={
                  prompt.baseDirectory
                    ? 'Type your answer… (# or @ for files, ⌘+Enter to send)'
                    : 'Type your answer… (⌘+Enter to send)'
                }
                onSubmit={onSubmit}
              />
            ) : (
              <ChannelComposer
                enabled={Boolean(sessionChannel)}
                baseDirectory={
                  activeConnectionId
                    ? connections.get(activeConnectionId)?.baseDirectory
                    : undefined
                }
                placeholder="Message the agent… (⌘+Enter to queue)"
                onSubmit={(text) => {
                  if (sessionChannel)
                    onQueueSessionMessage(sessionChannel.sessionId, text);
                }}
              />
            )}

            {prompt?.predefinedOptions &&
              prompt.predefinedOptions.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-4 py-2 border-t border-[var(--color-border)]">
                  {prompt.predefinedOptions.map((option) => (
                    <button
                      key={option}
                      onClick={() => onSelectOption(option)}
                      className="px-2.5 py-1 rounded-sm border border-[var(--color-border)] text-xs text-[var(--color-text-muted)] hover:border-[var(--color-user)] hover:text-[var(--color-user)] transition-colors"
                    >
                      {option}
                    </button>
                  ))}
                </div>
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
