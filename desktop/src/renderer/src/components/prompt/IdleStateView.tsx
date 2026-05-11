import { memo, useState, useCallback } from 'react';
import type { Attachment } from '../../types';
import NewSessionInput from './NewSessionInput';

type PinnedProject = {
  path: string;
  name: string;
};

/** Model selection for new session creation */
type ModelSelection = {
  providerId: string;
  modelId: string;
  variant?: string;
};

type Props = {
  /** Whether the OpenCode backend is available */
  isOpenCodeAvailable?: boolean;
  /** Callback to create a new session with baseDirectory */
  onCreateSession?: (
    initialMessage: string,
    baseDirectory: string,
    attachments?: Attachment[],
    modelSelection?: ModelSelection,
    agent?: string,
  ) => Promise<void>;
  /** List of pinned projects */
  pinnedProjects?: PinnedProject[];
  /** Callback to add a new project folder */
  onAddProject?: () => Promise<string | null>;
  /** Pre-selected project path (from sidebar "New Session" button) */
  preSelectedProject?: string | null;
  /** Callback to clear the pre-selected project after it's been used */
  onClearPreSelectedProject?: () => void;
};

/**
 * Displays the idle state when no prompt is active and no history exists.
 * Layout: centered headline ("How can I help you today?") plus the
 * new-session composer (which contains project/model/agent/variant chips).
 */
function IdleStateView({
  isOpenCodeAvailable = false,
  onCreateSession,
  pinnedProjects = [],
  onAddProject,
  preSelectedProject,
  onClearPreSelectedProject,
}: Props): React.ReactElement {
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateSession = useCallback(
    async (
      initialMessage: string,
      baseDirectory: string,
      attachments?: Attachment[],
      modelSelection?: ModelSelection,
      agent?: string,
    ) => {
      if (!onCreateSession) return;
      setIsCreating(true);
      try {
        await onCreateSession(
          initialMessage,
          baseDirectory,
          attachments,
          modelSelection,
          agent,
        );
        onClearPreSelectedProject?.();
        // Loader stays on success until this view unmounts on session
        // navigation: the IPC resolves before the SSE event that
        // populates the connections map and triggers the redirect.
      } catch (error) {
        setIsCreating(false);
        throw error;
      }
    },
    [onCreateSession, onClearPreSelectedProject],
  );

  const handleAddProject = useCallback(async (): Promise<string | null> => {
    if (!onAddProject) return null;
    return onAddProject();
  }, [onAddProject]);

  // OpenCode-backed session creation flow (preferred). Renders the centered
  // welcome layout: headline + composer. The composer's footer already exposes
  // the agent / model / variant chips inline next to the attachment + send
  // controls, so no separate top-left agent pill is rendered.
  if (isOpenCodeAvailable && onCreateSession && onAddProject) {
    return (
      <div className="flex h-full w-full flex-col">
        {/* Centered welcome — headline + composer. */}
        <div className="flex flex-1 items-center justify-center">
          <div className="anim-stagger-fade-up w-full max-w-2xl px-6">
            <h1
              className="mb-6 text-center text-2xl font-semibold text-[var(--color-text)]"
              data-stagger-index="0"
            >
              How can I help you today?
            </h1>
            <div data-stagger-index="1">
              <NewSessionInput
                onCreateSession={handleCreateSession}
                isCreating={isCreating}
                pinnedProjects={pinnedProjects}
                onAddProject={handleAddProject}
                placeholder="Ask the agent…"
                preSelectedProject={preSelectedProject}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Default waiting state for non-OpenCode providers.
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--color-text-muted)]">
      <div className="flex items-center gap-2 text-lg">
        <span className="text-[var(--color-agent)]">❯</span>
        <span className="cursor-blink text-[var(--color-text-muted)]">_</span>
      </div>
      <p className="text-sm text-[var(--color-text-muted)]">
        Waiting for prompt from MCP client…
      </p>
    </div>
  );
}

export default memo(IdleStateView);
