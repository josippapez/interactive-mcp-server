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
 * Shows a "New Session" input for OpenCode backends, or a waiting message for other providers.
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
        // Clear the pre-selected project after successful session creation
        onClearPreSelectedProject?.();
      } finally {
        setIsCreating(false);
      }
    },
    [onCreateSession, onClearPreSelectedProject],
  );

  const handleAddProject = useCallback(async (): Promise<string | null> => {
    if (!onAddProject) return null;
    return onAddProject();
  }, [onAddProject]);

  // Show "New Session" input for OpenCode
  if (isOpenCodeAvailable && onCreateSession && onAddProject) {
    return (
      <div className="anim-stagger-fade-up flex flex-col items-center justify-center h-full gap-6 px-4">
        <div className="text-center" data-stagger-index="0">
          <div className="flex items-center justify-center gap-2 text-lg mb-2">
            <span className="text-[var(--color-agent)]">❯</span>
            <span className="text-[var(--color-text-muted)]">
              Start a new session
            </span>
          </div>
          <p
            className="text-sm text-[var(--color-text-faint)]"
            data-stagger-index="1"
          >
            Select a project and type a message to begin
          </p>
        </div>
        <div data-stagger-index="2">
          <NewSessionInput
            onCreateSession={handleCreateSession}
            isCreating={isCreating}
            pinnedProjects={pinnedProjects}
            onAddProject={handleAddProject}
            placeholder="What would you like to work on?"
            preSelectedProject={preSelectedProject}
          />
        </div>
      </div>
    );
  }

  // Default waiting state for non-OpenCode providers
  return (
    <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)] gap-2">
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
