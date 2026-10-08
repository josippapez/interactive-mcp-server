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
  onSubmitForSession: (
    sessionId: string,
    answer: string,
    attachments?: Attachment[],
  ) => void;
  onSelectOption: (option: string) => void;
  onSelectOptionForSession: (sessionId: string, option: string) => void;
  onDismissStatus: (connectionId: string, timestamp: Date) => void;
  onDismissSession: (connectionId: string) => void;
  onQueueSessionMessage: (
    sessionId: string,
    message: string,
    attachments?: Attachment[],
  ) => void;
  onQueueSessionMessageForSession: (
    sessionId: string,
    message: string,
    attachments?: Attachment[],
  ) => void;
  onInjectWithReply?: (
    sessionId: string,
    message: string,
    attachments?: Attachment[],
    modelOverride?: ModelOverride,
    /**
     * Optional per-message OpenCode agent override (e.g. 'plan',
     * 'docs-maintainer'). Whitespace-only or empty values fall back to the
     * session's default agent. The override is sticky in-session: the UI
     * keeps the picked agent for subsequent prompts in the same channel
     * until the user changes it or the session/app is reopened.
     */
    agent?: string,
  ) => void;
  onInjectWithReplyForSession?: (
    sessionId: string,
    message: string,
    attachments?: Attachment[],
    modelOverride?: ModelOverride,
    agent?: string,
  ) => void;
  onClearMessages: (sessionId: string) => void;
  onRemoveSession: (sessionId: string) => Promise<boolean>;
  onToggleDocContext: () => void;
  onToggleDocContextForSession: (sessionId: string) => void;
  onEnsureSessionHistory: (sessionId: string) => void;
  onReplyQuestion: (
    requestId: string,
    answers: string[][],
    sessionID: string,
  ) => void;
  onRejectQuestion: (requestId: string, sessionID: string) => void;
  /** Active top-level app tab — used by the sidebar nav rows */
  activeTab?: 'prompt' | 'skills' | 'settings';
  /** Switch top-level app tab from sidebar nav rows */
  onNavigate?: (tab: 'prompt' | 'skills' | 'settings') => void;
  /** Called when user clicks the "New chat" sidebar nav row */
  onNewChat?: () => void;
  /** Called when user clicks the "Search" sidebar nav row (opens QuickSwitcher) */
  onOpenSearch?: () => void;
  /**
   * Optional content to render in place of the channel area (right pane).
   * Used so non-channel views (Skills, Settings) can keep the sidebar
   * mounted and visible — letting the user navigate back to "Home" via
   * the sidebar's nav rows. When provided, ChannelHeader / chat history /
   * composer are NOT rendered.
   */
  rightPaneOverride?: React.ReactNode;
};

export type ParentInfo = { id: string; title: string };
