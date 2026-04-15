import ChannelComposer from '../../components/prompt/ChannelComposer';
import type { ModelOverride } from '../../hooks/useProviderInjection';
import type { Model } from '../../hooks/useProviders';
import type { Attachment, SessionStatus } from '../../types';
import { getActiveChannelIdSnapshot } from '../../store/channel-selection';

type Props = {
  promptActive: boolean;
  promptBaseDirectory?: string;
  promptPlaceholder: string;
  queueBaseDirectory?: string;
  enabled: boolean;
  sessionChannelId?: string;
  dispatchSessionId?: string;
  openCodeSessionId: string | null;
  isOpenCodeSession: boolean;
  noReply: boolean;
  commandPaletteOpen: boolean;
  modelId?: string | null;
  providerId?: string | null;
  variant?: string;
  latestStatus: SessionStatus | null;
  connectionId: string | null;
  isBusy: boolean;
  docContextEnabled: boolean;
  onSubmit: (text: string, attachments?: Attachment[]) => void;
  onQueueSubmit: (text: string, attachments?: Attachment[]) => void;
  onSubmitWithReply?: (
    sessionId: string,
    text: string,
    attachments?: Attachment[],
    modelOverride?: ModelOverride,
  ) => void;
  onNoReplyChange: (value: boolean) => void;
  onCommandPaletteChange: (open: boolean) => void;
  onModelSelect: (model: Model, variant?: string) => void;
  onDismissStatus: (connectionId: string, timestamp: Date) => void;
  onToggleDocContext: () => void;
  currentModelOverride?: ModelOverride;
};

export function PromptComposerSection({
  promptActive,
  promptBaseDirectory,
  promptPlaceholder,
  queueBaseDirectory,
  enabled,
  sessionChannelId,
  dispatchSessionId,
  openCodeSessionId,
  isOpenCodeSession,
  noReply,
  commandPaletteOpen,
  modelId,
  providerId,
  variant,
  latestStatus,
  connectionId,
  isBusy,
  docContextEnabled,
  onSubmit,
  onQueueSubmit,
  onSubmitWithReply,
  onNoReplyChange,
  onCommandPaletteChange,
  onModelSelect,
  onDismissStatus,
  onToggleDocContext,
  currentModelOverride,
}: Props): React.ReactElement {
  const logComposerSubmit = (
    mode: 'queue' | 'reply',
    text: string,
    attachments?: Attachment[],
  ) => {
    if (typeof window === 'undefined' || !window.api?.log) {
      return;
    }

    window.api.log(
      'info',
      'composer-submit',
      JSON.stringify({
        mode,
        currentActiveChannelId: getActiveChannelIdSnapshot(),
        dispatchSessionId,
        sessionChannelId,
        openCodeSessionId,
        connectionId,
        isOpenCodeSession,
        noReply,
        messageLength: text.length,
        attachmentsCount: attachments?.length ?? 0,
        timestamp: new Date().toISOString(),
      }),
    );
  };

  if (promptActive) {
    return (
      <ChannelComposer
        enabled
        baseDirectory={promptBaseDirectory}
        placeholder={promptPlaceholder}
        onSubmit={onSubmit}
        sessionId={openCodeSessionId}
        commandPaletteOpen={commandPaletteOpen}
        onCommandPaletteChange={onCommandPaletteChange}
        modelId={modelId ?? undefined}
        providerId={providerId ?? undefined}
        variant={variant}
        onModelSelect={onModelSelect}
        isOpenCodeSession={isOpenCodeSession}
        latestStatus={latestStatus}
        connectionId={connectionId}
        onDismissStatus={onDismissStatus}
        isBusy={isBusy}
        docContextEnabled={docContextEnabled}
        onToggleDocContext={onToggleDocContext}
      />
    );
  }

  return (
    <ChannelComposer
      enabled={enabled}
      submitLabel="Queue"
      baseDirectory={queueBaseDirectory}
      placeholder="Message the agent… (/ for commands, ⌘+Enter to queue, ↵ to trigger reply)"
      onSubmit={(text, attachments) => {
        logComposerSubmit('queue', text, attachments);
        onQueueSubmit(text, attachments);
      }}
      showReplyButton={Boolean(openCodeSessionId) && isOpenCodeSession}
      onSubmitWithReply={(text, attachments) => {
        logComposerSubmit('reply', text, attachments);
        if (dispatchSessionId && onSubmitWithReply) {
          onSubmitWithReply(
            dispatchSessionId,
            text,
            attachments,
            currentModelOverride,
          );
        }
      }}
      noReply={noReply}
      onNoReplyChange={onNoReplyChange}
      sessionId={openCodeSessionId}
      commandPaletteOpen={commandPaletteOpen}
      onCommandPaletteChange={onCommandPaletteChange}
      modelId={modelId ?? undefined}
      providerId={providerId ?? undefined}
      variant={variant}
      onModelSelect={onModelSelect}
      isOpenCodeSession={isOpenCodeSession}
      latestStatus={latestStatus}
      connectionId={connectionId}
      onDismissStatus={onDismissStatus}
      isBusy={isBusy}
      docContextEnabled={docContextEnabled}
      onToggleDocContext={onToggleDocContext}
    />
  );
}
