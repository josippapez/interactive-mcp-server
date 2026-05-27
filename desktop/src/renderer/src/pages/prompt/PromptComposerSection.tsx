import ChannelComposer from '../../components/prompt/ChannelComposer';
import { SessionLoadedSkillsPanel } from '../../components/prompt/SessionLoadedSkillsPanel';
import type { ModelOverride } from '../../hooks/useProviderInjection';
import type { Model } from '../../hooks/useProviders';
import type { NativeOpenCodeSkill } from '../../../../preload/api/types';
import type { Attachment } from '../../types';
import { getActiveChannelIdSnapshot } from '../../store/channel-selection';

type Props = {
  promptActive: boolean;
  promptBaseDirectory?: string;
  promptPlaceholder: string;
  queueBaseDirectory?: string;
  enabled: boolean;
  sessionChannelId?: string;
  dispatchSessionId?: string;
  providerSessionId: string | null;
  sessionBaseDirectory?: string | null;
  isOpenCodeSession: boolean;
  noReply: boolean;
  commandPaletteOpen: boolean;
  modelId?: string | null;
  providerId?: string | null;
  variant?: string;
  activeSkills: NativeOpenCodeSkill[];
  connectionId: string | null;
  docContextEnabled: boolean;
  onSubmit: (text: string, attachments?: Attachment[]) => void;
  onQueueSubmit: (text: string, attachments?: Attachment[]) => void;
  onSubmitWithReply?: (
    sessionId: string,
    text: string,
    attachments?: Attachment[],
    modelOverride?: ModelOverride,
    agent?: string,
  ) => void;
  onNoReplyChange: (value: boolean) => void;
  onCommandPaletteChange: (open: boolean) => void;
  onModelSelect: (model: Model, variant?: string) => void;
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
  providerSessionId,
  sessionBaseDirectory,
  isOpenCodeSession,
  noReply,
  commandPaletteOpen,
  modelId,
  providerId,
  variant,
  activeSkills,
  connectionId,
  docContextEnabled,
  onSubmit,
  onQueueSubmit,
  onSubmitWithReply,
  onNoReplyChange,
  onCommandPaletteChange,
  onModelSelect,
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
        providerSessionId,
        connectionId,
        isOpenCodeSession,
        noReply,
        messageLength: text.length,
        attachmentsCount: attachments?.length ?? 0,
        timestamp: new Date().toISOString(),
      }),
      providerSessionId ?? sessionChannelId ?? dispatchSessionId,
    );
  };

  if (promptActive) {
    return (
      <ChannelComposer
        enabled
        baseDirectory={sessionBaseDirectory ?? promptBaseDirectory}
        placeholder={promptPlaceholder}
        onSubmit={onSubmit}
        sessionId={providerSessionId}
        providerSessionId={providerSessionId}
        commandPaletteOpen={commandPaletteOpen}
        onCommandPaletteChange={onCommandPaletteChange}
        modelId={modelId ?? undefined}
        providerId={providerId ?? undefined}
        variant={variant}
        onModelSelect={onModelSelect}
        isOpenCodeSession={isOpenCodeSession}
        connectionId={connectionId}
        docContextEnabled={docContextEnabled}
        onToggleDocContext={onToggleDocContext}
      />
    );
  }

  return (
    <>
      {isOpenCodeSession && <SessionLoadedSkillsPanel skills={activeSkills} />}
      <ChannelComposer
        enabled={enabled}
        submitLabel="Queue"
        baseDirectory={sessionBaseDirectory ?? queueBaseDirectory}
        placeholder="Message the agent… (/ for commands, ⌘+Enter to queue, ↵ to trigger reply)"
        onSubmit={(text, attachments) => {
          logComposerSubmit('queue', text, attachments);
          onQueueSubmit(text, attachments);
        }}
        showReplyButton={Boolean(providerSessionId) && isOpenCodeSession}
        onSubmitWithReply={(text, attachments, agent) => {
          logComposerSubmit('reply', text, attachments);
          if (dispatchSessionId && onSubmitWithReply) {
            onSubmitWithReply(
              dispatchSessionId,
              text,
              attachments,
              currentModelOverride,
              agent,
            );
          }
        }}
        noReply={noReply}
        onNoReplyChange={onNoReplyChange}
        sessionId={providerSessionId}
        providerSessionId={providerSessionId}
        commandPaletteOpen={commandPaletteOpen}
        onCommandPaletteChange={onCommandPaletteChange}
        modelId={modelId ?? undefined}
        providerId={providerId ?? undefined}
        variant={variant}
        onModelSelect={onModelSelect}
        isOpenCodeSession={isOpenCodeSession}
        connectionId={connectionId}
        docContextEnabled={docContextEnabled}
        onToggleDocContext={onToggleDocContext}
      />
    </>
  );
}
