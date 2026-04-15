import type {
  Attachment,
  ChannelMessage,
  PromptData,
  SessionNode,
  SessionStatus,
} from '../../types';
import type { ModelOverride } from '../../hooks/useProviderInjection';

export type ModelOverrideMap = Map<string, ModelOverride>;

export type PromptViewProps = {
  connections: Map<string, SessionNode>;
  activeConnectionId: string | null;
  onSelectConnection: (connectionId: string | null) => void;
  prompt: PromptData | null;
  activeSession: { id: string; title: string } | null;
  channelMessages: ChannelMessage[];
  connectionId: string | null;
  sessionChannel: { sessionId: string; label?: string } | null;
  sessionStatuses: SessionStatus[];
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
  onInjectWithReply?: (
    sessionId: string,
    message: string,
    attachments?: Attachment[],
    modelOverride?: ModelOverride,
  ) => void;
  onClearMessages: (sessionId: string) => void;
  onRemoveSession: (sessionId: string) => Promise<boolean>;
  onToggleDocContext: () => void;
};

export type ParentInfo = { id: string; title: string };
