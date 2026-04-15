import { memo, useState, useCallback, useRef } from 'react';
import type { Attachment } from '../../types';
import NewSessionInput from './NewSessionInput';
import { gsap, prefersReducedMotion, useGSAP } from '../../lib/gsap';

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
  const containerRef = useRef<HTMLDivElement | null>(null);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;

      gsap.from(
        '[data-gsap-idle-title], [data-gsap-idle-subtitle], [data-gsap-idle-input]',
        {
          y: 10,
          opacity: 0,
          duration: 0.4,
          ease: 'power2.out',
          stagger: 0.06,
        },
      );
    },
    {
      scope: containerRef,
      dependencies: [isOpenCodeAvailable, preSelectedProject],
    },
  );

  const handleCreateSession = useCallback(
    async (
      initialMessage: string,
      baseDirectory: string,
      attachments?: Attachment[],
      modelSelection?: ModelSelection,
    ) => {
      if (!onCreateSession) return;
      setIsCreating(true);
      try {
        await onCreateSession(
          initialMessage,
          baseDirectory,
          attachments,
          modelSelection,
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
      <div
        ref={containerRef}
        className="flex flex-col items-center justify-center h-full gap-6 px-4"
      >
        <div className="text-center" data-gsap-idle-title>
          <div className="flex items-center justify-center gap-2 text-lg mb-2">
            <span className="text-[var(--color-agent)]">❯</span>
            <span className="text-[var(--color-text-muted)]">
              Start a new session
            </span>
          </div>
          <p
            className="text-sm text-[var(--color-text-faint)]"
            data-gsap-idle-subtitle
          >
            Select a project and type a message to begin
          </p>
        </div>
        <div data-gsap-idle-input>
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
