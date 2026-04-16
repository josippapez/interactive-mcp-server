import type {
  Attachment,
  ChannelMessage,
  PendingQuestion,
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
  pendingQuestions: PendingQuestion[];
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
  onReplyQuestion: (
    requestId: string,
    answers: string[][],
    sessionID: string,
  ) => void;
  onRejectQuestion: (requestId: string, sessionID: string) => void;
};

export type ParentInfo = { id: string; title: string };
