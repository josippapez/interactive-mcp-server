import { memo, useState, useCallback, useRef, useEffect } from 'react';
import type { Attachment } from '../../types';
import { useAttachments } from '../../hooks/useAttachments';
import { useProviders, type Model } from '../../hooks/useProviders';
import AttachmentPreview from './AttachmentPreview';
import ModelChip from './ModelChip';
import ModelPopover from './ModelPopover';
import VariantSelector from './VariantSelector';

const SELECTED_PROJECT_KEY = 'sidebar-selected-project';

function readPersistedProjectSelection(): string {
  try {
    const stored = localStorage.getItem(SELECTED_PROJECT_KEY);
    return stored ? (JSON.parse(stored) as string | null) ?? '' : '';
  } catch {
    return '';
  }
}

function persistProjectSelection(path: string): void {
  try {
    localStorage.setItem(SELECTED_PROJECT_KEY, JSON.stringify(path || null));
  } catch {
    // Ignore local storage failures.
  }
}

type PinnedProject = {
  path: string;
  name: string;
};

/** Model override for new session creation */
type ModelSelection = {
  providerId: string;
  modelId: string;
  variant?: string;
};

type Props = {
  /** Called when the user submits a new session request */
  onCreateSession: (
    initialMessage: string,
    baseDirectory: string,
    attachments?: Attachment[],
    modelSelection?: ModelSelection,
  ) => Promise<void>;
  /** Whether a session creation is in progress */
  isCreating?: boolean;
  /** Optional placeholder text */
  placeholder?: string;
  /** List of pinned projects to choose from */
  pinnedProjects: PinnedProject[];
  /** Callback to open folder dialog and add a new project */
  onAddProject: () => Promise<string | null>;
  /** Pre-selected project path (from sidebar "New Session" button) */
  preSelectedProject?: string | null;
};

/**
 * Input component for starting a new OpenCode session.
 * Allows users to select a project folder and type an initial message.
 * Supports image attachments via paste or file picker.
 */
function NewSessionInput({
  onCreateSession,
  isCreating = false,
  placeholder = 'What would you like to work on?',
  pinnedProjects,
  onAddProject,
  preSelectedProject,
}: Props): React.ReactElement {
  const [message, setMessage] = useState('');
  const [selectedProject, setSelectedProject] = useState<string>(
    preSelectedProject ?? readPersistedProjectSelection(),
  );
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [expandedImage, setExpandedImage] = useState<{
    src: string;
    name: string;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Model selector state
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<string | undefined>(
    undefined,
  );
  const {
    providers,
    models,
    isLoading: modelsLoading,
    isConnected,
  } = useProviders();

  // Only show models from connected providers
  const connectedModels = models.filter((m) => isConnected(m.providerId));
  const connectedProviders = providers.filter((p) => isConnected(p.id));

  // Attachment handling
  const {
    attachments,
    setAttachments,
    handlePaste,
    handleFilePicker,
    removeAttachment,
  } = useAttachments(!isCreating);

  // Keep the selected project aligned with the current rail selection.
  useEffect(() => {
    if (pinnedProjects.length === 0) {
      if (selectedProject) {
        setSelectedProject('');
      }
      return;
    }

    const availablePaths = new Set(pinnedProjects.map((project) => project.path));
    if (selectedProject && availablePaths.has(selectedProject)) {
      return;
    }

    const persistedProject = readPersistedProjectSelection();
    const nextProject =
      (preSelectedProject && availablePaths.has(preSelectedProject)
        ? preSelectedProject
        : null) ||
      (persistedProject && availablePaths.has(persistedProject)
        ? persistedProject
        : null) ||
      pinnedProjects[0]?.path ||
      '';

    if (nextProject !== selectedProject) {
      setSelectedProject(nextProject);
    }
  }, [pinnedProjects, preSelectedProject, selectedProject]);

  // Sync selectedProject when preSelectedProject changes (e.g., from sidebar "New Session" button)
  useEffect(() => {
    if (preSelectedProject) {
      setSelectedProject(preSelectedProject);
      persistProjectSelection(preSelectedProject);
    }
  }, [preSelectedProject]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }
    persistProjectSelection(selectedProject);
  }, [selectedProject]);

  // Auto-resize textarea when message changes
  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setMessage(e.target.value);
      resizeTextarea();
    },
    [resizeTextarea],
  );

  useEffect(() => {
    resizeTextarea();
  }, [resizeTextarea]);

  const handleSubmit = useCallback(async () => {
    const trimmed = message.trim();
    if (
      (!trimmed && attachments.length === 0) ||
      isCreating ||
      !selectedProject
    )
      return;

    // Build model selection if a model is selected
    const modelSelection = selectedModel
      ? {
          providerId: selectedModel.providerId,
          modelId: selectedModel.id,
          variant: selectedVariant,
        }
      : undefined;

    await onCreateSession(
      trimmed,
      selectedProject,
      attachments.length > 0 ? attachments : undefined,
      modelSelection,
    );
    setMessage('');
    setAttachments([]);
  }, [
    message,
    attachments,
    isCreating,
    selectedProject,
    selectedModel,
    selectedVariant,
    onCreateSession,
    setAttachments,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Cmd/Ctrl+Enter to submit
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  // Handle model selection from popover
  const handleModelSelect = useCallback((model: Model) => {
    setSelectedModel(model);
    setSelectedVariant(model.defaultVariant);
    setPopoverOpen(false);
  }, []);

  // Handle variant selection
  const handleVariantSelect = useCallback((variant: string | undefined) => {
    setSelectedVariant(variant);
  }, []);

  const handleAddNewProject = useCallback(async () => {
    setIsAddingProject(true);
    try {
      const newPath = await onAddProject();
      if (newPath) {
        setSelectedProject(newPath);
        persistProjectSelection(newPath);
      }
    } finally {
      setIsAddingProject(false);
    }
  }, [onAddProject]);

  const handleProjectChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      if (value === '__add_new__') {
        handleAddNewProject();
      } else {
        setSelectedProject(value);
        persistProjectSelection(value);
      }
    },
    [handleAddNewProject],
  );

  // Stable callback for expanding images (passed to memoized AttachmentPreview)
  const handleExpandImage = useCallback((src: string, name: string) => {
    setExpandedImage({ src, name });
  }, []);

  const canSubmit =
    (message.trim() || attachments.length > 0) &&
    selectedProject &&
    !isCreating;

  return (
    <>
      <div className="w-full max-w-[68rem] mx-auto">
        <div className="relative rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm focus-within:border-[var(--color-agent)] focus-within:ring-1 focus-within:ring-[var(--color-agent)]/20 transition-all">
          {/* Project selector */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)]">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-[var(--color-text-faint)] shrink-0"
              aria-hidden="true"
            >
              <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
            </svg>
            <select
              value={selectedProject}
              onChange={handleProjectChange}
              disabled={isCreating || isAddingProject}
              className="flex-1 bg-transparent text-sm text-[var(--color-text)] focus:outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {pinnedProjects.length === 0 && !selectedProject && (
                <option value="" disabled>
                  Select a project folder…
                </option>
              )}
              {pinnedProjects.map((project) => (
                <option key={project.path} value={project.path}>
                  {project.name}
                </option>
              ))}
              <option value="__add_new__">+ Add project folder…</option>
            </select>
            {isAddingProject && (
              <span className="w-3 h-3 border-2 border-[var(--color-agent)]/30 border-t-[var(--color-agent)] rounded-full animate-spin" />
            )}
          </div>

          {/* Attachment preview */}
          {attachments.length > 0 && (
            <div className="px-3 py-2 border-b border-[var(--color-border)]">
              <AttachmentPreview
                attachments={attachments}
                onRemove={removeAttachment}
                onExpand={handleExpandImage}
              />
            </div>
          )}

          {/* Message input */}
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              selectedProject ? placeholder : 'Select a project folder first…'
            }
            disabled={isCreating || !selectedProject}
            rows={3}
            className="w-full px-4 py-3 bg-transparent text-[var(--color-text)] placeholder-[var(--color-text-faint)] resize-none focus:outline-none disabled:opacity-50"
          />

          {/* Model popover - positioned above the model chip */}
          <ModelPopover
            isOpen={popoverOpen}
            onClose={() => setPopoverOpen(false)}
            models={connectedModels}
            providers={connectedProviders}
            currentModelId={selectedModel?.id}
            onSelectModel={handleModelSelect}
          />

          {/* Footer with model selector, hint, and submit button */}
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-[var(--color-border)]">
            <div className="flex items-center gap-2 min-w-0 flex-1 pr-2">
              {/* Model selector */}
              <div className="flex items-center gap-1.5">
                <ModelChip
                  currentModel={selectedModel}
                  currentVariant={selectedVariant}
                  isOpen={popoverOpen}
                  onClick={() => !modelsLoading && setPopoverOpen(!popoverOpen)}
                  disabled={isCreating}
                  isLoading={modelsLoading && connectedModels.length === 0}
                />
                {selectedModel?.variants &&
                  selectedModel.variants.length > 0 && (
                    <VariantSelector
                      variants={selectedModel.variants}
                      currentVariant={selectedVariant}
                      onSelectVariant={handleVariantSelect}
                      disabled={isCreating}
                    />
                  )}
              </div>

              {/* Separator */}
              <div className="w-px h-4 bg-[var(--color-border)]" />

              {/* Attachment button */}
              <button
                type="button"
                onClick={handleFilePicker}
                disabled={isCreating || !selectedProject}
                title="Attach file"
                className="px-2 py-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-agent)] hover:bg-[var(--color-agent)]/10 transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                📎
              </button>
              <span className="text-xs text-[var(--color-text-faint)] hidden sm:inline truncate">
                {selectedProject ? '⌘+Enter to send' : 'Select a project first'}
              </span>
            </div>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-[var(--color-agent)] text-white hover:opacity-90"
            >
              {isCreating ? (
                <>
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m22 2-7 20-4-9-9-4Z" />
                    <path d="M22 2 11 13" />
                  </svg>
                  Start Session
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Expanded image modal (lightbox) */}
      {expandedImage && (
        <div
          role="dialog"
          aria-label="Image preview"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setExpandedImage(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setExpandedImage(null);
          }}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between w-full mb-2 px-1">
              <span className="text-xs text-white/70 truncate max-w-[80%]">
                {expandedImage.name}
              </span>
              <button
                type="button"
                onClick={() => setExpandedImage(null)}
                className="text-white/70 hover:text-white text-sm px-2 py-0.5"
                aria-label="Close image preview"
              >
                ESC
              </button>
            </div>
            <img
              src={expandedImage.src}
              alt={expandedImage.name}
              className="max-w-full max-h-[85vh] rounded-sm object-contain"
            />
          </div>
        </div>
      )}
    </>
  );
}

export default memo(NewSessionInput);
