import { memo, useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import type { Attachment } from '../../types';
import type { Model } from '../../hooks/useProviders';
import AttachmentPreview from './AttachmentPreview';
import AutocompleteDropdown from './AutocompleteDropdown';
import CommandPalette from './CommandPalette';
import { useProviders } from '../../hooks/useProviders';
import { useAutocomplete } from '../../hooks/useAutocomplete';
import { useAttachments } from '../../hooks/useAttachments';
import { ComposerBottomBar } from './composer/ComposerBottomBar';
import { ImageLightbox } from './composer/ImageLightbox';
import { resolveCurrentModel } from './model-resolution';
import {
  sessionAgentsAtom,
  setSessionAgentAtom,
} from '../../store/session-agents';
import {
  buildComposerDraftKey,
  clearComposerDraft,
  getComposerDraft,
  setComposerDraft,
} from './composer/composer-drafts';
import { getDefaultNativeAgentName } from './agent-picker-filter';

type Props = {
  enabled: boolean;
  baseDirectory?: string;
  placeholder: string;
  submitLabel?: string;
  onSubmit: (text: string, attachments?: Attachment[]) => void;
  /** Show "Send with Reply" button for triggering agent response (OpenCode only) */
  showReplyButton?: boolean;
  /**
   * Called when "Send with Reply" is clicked (noReply=false).
   * `agent` is the per-message OpenCode agent override (sticky in-session).
   * Pass `undefined` to use the session default agent.
   */
  onSubmitWithReply?: (
    text: string,
    attachments?: Attachment[],
    agent?: string,
  ) => void;
  /** Current noReply toggle state (controlled from parent) */
  noReply?: boolean;
  /** Called when noReply toggle changes */
  onNoReplyChange?: (noReply: boolean) => void;
  /** OpenCode session ID for command execution */
  sessionId?: string | null;
  /** OpenCode provider session ID for repository index status */
  providerSessionId?: string | null;
  /** Whether the command palette is open (controlled from parent for Cmd+K) */
  commandPaletteOpen?: boolean;
  /** Called when command palette open state changes */
  onCommandPaletteChange?: (open: boolean) => void;
  /** Current model ID for OpenCode sessions */
  modelId?: string | null;
  /** Current provider ID for OpenCode sessions */
  providerId?: string | null;
  /** Current variant/effort level for the model */
  variant?: string | null;
  /** Callback when model is selected */
  onModelSelect?: (model: Model, variant?: string) => void;
  /** Whether this is an OpenCode session (shows model selector) */
  isOpenCodeSession?: boolean;
  connectionId?: string | null;
  /** Whether doc context is enabled */
  docContextEnabled?: boolean;
  /** Callback to toggle doc context */
  onToggleDocContext?: () => void;
};

function ChannelComposer({
  enabled,
  baseDirectory,
  placeholder,
  submitLabel = 'Send',
  onSubmit,
  showReplyButton = false,
  onSubmitWithReply,
  noReply = true,
  onNoReplyChange,
  sessionId,
  providerSessionId,
  commandPaletteOpen: externalPaletteOpen,
  onCommandPaletteChange,
  modelId,
  providerId,
  variant,
  onModelSelect,
  isOpenCodeSession,
  connectionId,
  docContextEnabled = false,
  onToggleDocContext,
}: Props): React.ReactElement {
  const draftKey = useMemo(
    () =>
      buildComposerDraftKey({
        sessionId,
        connectionId,
        mode: showReplyButton ? 'queue' : 'prompt',
      }),
    [connectionId, sessionId, showReplyButton],
  );
  const [value, setValue] = useState(() => getComposerDraft(draftKey));
  const [expandedImage, setExpandedImage] = useState<{
    src: string;
    name: string;
  } | null>(null);
  // Internal command palette state (for "/" trigger)
  const [internalPaletteOpen, setInternalPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Model selector state
  const [popoverOpen, setPopoverOpen] = useState(false);
  const {
    providers,
    models,
    isLoading: modelsLoading,
    isConnected,
  } = useProviders();

  // Per-message agent override (sticky in-session, keyed by connectionId).
  // In-memory only — clears on app restart and on new sessions.
  const sessionAgents = useAtomValue(sessionAgentsAtom);
  const setSessionAgent = useSetAtom(setSessionAgentAtom);
  const selectedAgent = connectionId
    ? (sessionAgents.get(connectionId) ?? null)
    : null;
  const [agentPopoverOpen, setAgentPopoverOpen] = useState(false);
  const [availableAgents, setAvailableAgents] = useState<
    import('../../../../preload').AgentDefinition[]
  >([]);
  const defaultAgentName = useMemo(
    () => getDefaultNativeAgentName(availableAgents),
    [availableAgents],
  );

  useEffect(() => {
    if (!isOpenCodeSession) {
      setAvailableAgents([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      const result = await window.api.listAgents(baseDirectory);
      if (!cancelled && result.ok) setAvailableAgents(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [baseDirectory, isOpenCodeSession]);

  const handleAgentSelect = useCallback(
    (agent: string | null) => {
      if (!connectionId) return;
      setSessionAgent({ connectionId, agent });
    },
    [connectionId, setSessionAgent],
  );

  const handleAgentPopoverToggle = useCallback(() => {
    setAgentPopoverOpen((prev) => !prev);
  }, []);

  const handleDefaultAgentResolved = useCallback((agent: string | null) => {
    setAvailableAgents((prev) => {
      if (!agent || prev.some((item) => item.name === agent)) return prev;
      return [
        {
          name: agent,
          filePath: `opencode-native:${agent}`,
          scope: 'global',
          description: 'OpenCode default agent',
          mode: 'primary',
          tools: {},
          body: '',
          rawContents: '',
          native: true,
        },
        ...prev,
      ];
    });
  }, []);

  useEffect(() => {
    setValue(getComposerDraft(draftKey));
  }, [draftKey]);

  // Command palette can be opened externally (Cmd+K) or internally (/)
  const commandPaletteOpen = externalPaletteOpen || internalPaletteOpen;

  // Only show models from connected providers in the popover
  const connectedModels = useMemo(
    () => models.filter((m) => isConnected(m.providerId)),
    [models, isConnected],
  );
  const connectedProviders = useMemo(
    () => providers.filter((p) => isConnected(p.id)),
    [providers, isConnected],
  );

  // Find current model info
  const currentModel = resolveCurrentModel(models, modelId, providerId);

  // Show model selector for OpenCode sessions
  const showModelSelector = modelId || isOpenCodeSession;

  const handleClosePalette = useCallback(() => {
    setInternalPaletteOpen(false);
    setCommandQuery('');
    onCommandPaletteChange?.(false);
    // Clear the "/" from input if it was typed
    if (value.startsWith('/')) {
      setValue('');
      clearComposerDraft(draftKey);
    }
    // Refocus textarea
    textareaRef.current?.focus();
  }, [draftKey, value, onCommandPaletteChange]);

  const handleCommandExecuted = useCallback(
    (commandName: string) => {
      // Clear input after successful command execution
      setValue('');
      clearComposerDraft(draftKey);
      setCommandQuery('');
      setInternalPaletteOpen(false);
      onCommandPaletteChange?.(false);
    },
    [draftKey, onCommandPaletteChange],
  );

  // Handle model selection from popover
  const handleModelSelect = useCallback(
    (model: Model) => {
      if (model.id !== modelId) {
        onModelSelect?.(model, model.defaultVariant);
      } else {
        onModelSelect?.(model, variant ?? undefined);
      }
      setPopoverOpen(false);
    },
    [modelId, variant, onModelSelect],
  );

  // Handle variant selection
  const handleVariantSelect = useCallback(
    (newVariant: string | undefined) => {
      if (currentModel) {
        onModelSelect?.(currentModel, newVariant);
      }
    },
    [currentModel, onModelSelect],
  );

  const {
    target,
    suggestions,
    loading,
    selectedIndex,
    setSelectedIndex,
    detectAutocomplete,
    applySuggestion,
    clearSuggestions,
  } = useAutocomplete(baseDirectory);

  const {
    attachments,
    setAttachments,
    handlePaste,
    handleFilePicker,
    removeAttachment,
  } = useAttachments(enabled);

  const showSuggestions =
    target !== null && (loading || suggestions.length > 0);
  const triggerChar: '#' | '@' =
    target !== null && value[target.start] === '@' ? '@' : '#';

  const focusTextarea = useCallback((cursorPos: number) => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    ta.selectionStart = cursorPos;
    ta.selectionEnd = cursorPos;
  }, []);

  const handleSkillSelected = useCallback(
    (skillName: string) => {
      const next = `/${skillName} `;
      setValue(next);
      setComposerDraft(draftKey, next);
      setCommandQuery('');
      setInternalPaletteOpen(false);
      onCommandPaletteChange?.(false);
      requestAnimationFrame(() => focusTextarea(next.length));
    },
    [draftKey, focusTextarea, onCommandPaletteChange],
  );

  // Stable callback for expanding images (passed to memoized AttachmentPreview)
  const handleExpandImage = useCallback((src: string, name: string) => {
    setExpandedImage({ src, name });
  }, []);

  const handleApplySuggestion = useCallback(
    (filePath: string) => {
      applySuggestion(filePath, () => value, setValue, focusTextarea);
    },
    [applySuggestion, value, focusTextarea],
  );

  const submit = useCallback(() => {
    const text = value.trim();
    if (!enabled || (!text && attachments.length === 0)) {
      return;
    }

    // If Reply toggle is ON and we have the reply handler, use it
    // Otherwise use the regular submit (noReply mode)
    if (!noReply && onSubmitWithReply) {
      onSubmitWithReply(
        text,
        attachments.length > 0 ? attachments : undefined,
        selectedAgent ?? undefined,
      );
    } else {
      onSubmit(text, attachments.length > 0 ? attachments : undefined);
    }
    setValue('');
    clearComposerDraft(draftKey);
    setAttachments([]);
    clearSuggestions();
  }, [
    enabled,
    value,
    attachments,
    noReply,
    onSubmit,
    onSubmitWithReply,
    setAttachments,
    clearSuggestions,
    selectedAgent,
    draftKey,
  ]);

  const disabled = useMemo(
    () => !enabled || (!value.trim() && attachments.length === 0),
    [enabled, value, attachments.length],
  );

  // Auto-grow textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = '24px';
    const maxHeight = Math.min(300, window.innerHeight * 0.4);
    const newHeight = Math.max(24, Math.min(ta.scrollHeight, maxHeight));
    ta.style.height = `${newHeight}px`;
  }, [value]);

  // Handle popover toggle
  const handlePopoverToggle = useCallback(() => {
    if (!modelsLoading) {
      setPopoverOpen((prev) => !prev);
    }
  }, [modelsLoading]);

  return (
    <>
      <div className="p-3" data-composer>
        {/* Main composer container — rounded-rectangle surface via global
            `.composer-surface` utility (radius / border / background /
            focus ring all owned by the global utility in main.css). */}
        <div
          ref={containerRef}
          className={`composer-surface relative flex flex-col transition-all duration-150 ${
            !enabled ? 'opacity-60' : ''
          }`}
        >
          {/* Autocomplete dropdown */}
          {showSuggestions && (
            <AutocompleteDropdown
              suggestions={suggestions}
              selectedIndex={selectedIndex}
              isLoading={loading}
              triggerChar={triggerChar}
              onSelect={handleApplySuggestion}
              onHoverIndex={setSelectedIndex}
            />
          )}

          {/* Command palette */}
          {commandPaletteOpen && sessionId && (
            <CommandPalette
              sessionId={sessionId}
              open={commandPaletteOpen}
              onClose={handleClosePalette}
              initialQuery={commandQuery}
              onCommandExecuted={handleCommandExecuted}
              onSkillSelected={handleSkillSelected}
              baseDirectory={baseDirectory}
            />
          )}

          {/* Attachments preview */}
          {attachments.length > 0 && (
            <div className="px-3 pt-3 pb-1">
              <AttachmentPreview
                attachments={attachments}
                onRemove={removeAttachment}
                onExpand={handleExpandImage}
              />
            </div>
          )}

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={value}
            disabled={!enabled}
            onPaste={handlePaste}
            onChange={(e) => {
              const next = e.target.value;
              setValue(next);
              setComposerDraft(draftKey, next);

              // Detect "/" at start of input to open command palette
              if (sessionId && next.startsWith('/') && !internalPaletteOpen) {
                setInternalPaletteOpen(true);
                setCommandQuery(next.slice(1));
              } else if (internalPaletteOpen && next.startsWith('/')) {
                setCommandQuery(next.slice(1));
              } else if (internalPaletteOpen && !next.startsWith('/')) {
                setInternalPaletteOpen(false);
                setCommandQuery('');
              }

              detectAutocomplete(next, e.target.selectionStart ?? next.length);
            }}
            onKeyDown={(e) => {
              if (showSuggestions && suggestions.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setSelectedIndex((prev) =>
                    prev < suggestions.length - 1 ? prev + 1 : 0,
                  );
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setSelectedIndex((prev) =>
                    prev > 0 ? prev - 1 : suggestions.length - 1,
                  );
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  handleApplySuggestion(suggestions[selectedIndex]);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  clearSuggestions();
                  return;
                }
              }
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={placeholder}
            className="w-full bg-transparent px-5 pt-4 pb-2 text-sm text-[var(--color-text)] placeholder-[var(--color-text-faint)] focus:outline-none resize-none overflow-y-auto"
            rows={1}
            style={{ height: '24px', maxHeight: '300px' }}
          />

          {/* Bottom toolbar */}
          <ComposerBottomBar
            enabled={enabled}
            showModelSelector={!!showModelSelector}
            currentModel={currentModel}
            currentVariant={variant}
            popoverOpen={popoverOpen}
            onPopoverToggle={handlePopoverToggle}
            modelsLoading={modelsLoading}
            connectedModels={connectedModels}
            connectedProviders={connectedProviders}
            modelId={modelId}
            onModelSelect={handleModelSelect}
            onVariantSelect={handleVariantSelect}
            showAgentChip={Boolean(isOpenCodeSession && connectionId)}
            selectedAgent={selectedAgent}
            defaultAgentName={defaultAgentName}
            agentPopoverOpen={agentPopoverOpen}
            onAgentPopoverToggle={handleAgentPopoverToggle}
            onAgentPopoverChange={setAgentPopoverOpen}
            onAgentSelect={handleAgentSelect}
            onDefaultAgentResolved={handleDefaultAgentResolved}
            agentBaseDirectory={baseDirectory}
            docContextEnabled={docContextEnabled}
            onToggleDocContext={onToggleDocContext}
            baseDirectory={baseDirectory}
            providerSessionId={providerSessionId}
            onFilePicker={handleFilePicker}
            showReplyButton={showReplyButton}
            noReply={noReply}
            onNoReplyChange={onNoReplyChange}
            onSubmit={submit}
            disabled={disabled}
            submitLabel={submitLabel}
          />
        </div>
      </div>

      {/* Expanded image modal */}
      {expandedImage && (
        <ImageLightbox
          src={expandedImage.src}
          name={expandedImage.name}
          onClose={() => setExpandedImage(null)}
        />
      )}
    </>
  );
}

export default memo(ChannelComposer);
