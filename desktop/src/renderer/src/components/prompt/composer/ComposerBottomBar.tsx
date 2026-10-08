import { memo } from 'react';
import type { Model } from '../../../hooks/useProviders';
import AgentChip from '../AgentChip';
import AgentPopover from '../AgentPopover';
import ModelChip from '../ModelChip';
import ModelPopover from '../ModelPopover';
import VariantSelector from '../VariantSelector';
import { ArrowUpIcon, AttachIcon, DocIcon } from './ComposerIcons';
import { ReplyToggle } from './ReplyToggle';
import { RepositoryIndexBadge } from './RepositoryIndexBadge';
import type { Provider } from '../../../hooks/useProviders';
import { McpStatusDropdown } from '../McpStatusPanel';
import type { McpStatusPanelProps } from '../McpStatusPanel';

type ComposerBottomBarProps = {
  enabled: boolean;
  // Model selector props
  showModelSelector: boolean;
  currentModel: Model | null;
  currentVariant: string | null | undefined;
  popoverOpen: boolean;
  onPopoverToggle: () => void;
  modelsLoading: boolean;
  connectedModels: Model[];
  connectedProviders: Provider[];
  modelId: string | null | undefined;
  onModelSelect: (model: Model) => void;
  onVariantSelect: (variant: string | undefined) => void;
  // Agent selector props (OpenCode only — sticky in-session)
  showAgentChip: boolean;
  selectedAgent: string | null;
  defaultAgentName?: string | null;
  agentPopoverOpen: boolean;
  onAgentPopoverToggle: () => void;
  onAgentPopoverChange: (open: boolean) => void;
  onAgentSelect: (agent: string | null) => void;
  onDefaultAgentResolved?: (agent: string | null) => void;
  agentBaseDirectory: string | undefined;
  // Doc context props
  docContextEnabled: boolean;
  onToggleDocContext: (() => void) | undefined;
  baseDirectory?: string | null;
  providerSessionId: string | null | undefined;
  mcpStatus?: McpStatusPanelProps;
  // Attachment props
  onFilePicker: () => void;
  // Reply toggle props
  showReplyButton: boolean;
  noReply: boolean;
  onNoReplyChange: ((noReply: boolean) => void) | undefined;
  // Submit props
  onSubmit: () => void;
  disabled: boolean;
  submitLabel: string;
};

/** Bottom toolbar with model selector and action buttons. */
function ComposerBottomBarComponent({
  enabled,
  showModelSelector,
  currentModel,
  currentVariant,
  popoverOpen,
  onPopoverToggle,
  modelsLoading,
  connectedModels,
  connectedProviders,
  modelId,
  onModelSelect,
  onVariantSelect,
  showAgentChip,
  selectedAgent,
  defaultAgentName,
  agentPopoverOpen,
  onAgentPopoverToggle,
  onAgentPopoverChange,
  onAgentSelect,
  onDefaultAgentResolved,
  agentBaseDirectory,
  docContextEnabled,
  onToggleDocContext,
  baseDirectory,
  providerSessionId,
  mcpStatus,
  onFilePicker,
  showReplyButton,
  noReply,
  onNoReplyChange,
  onSubmit,
  disabled,
  submitLabel,
}: ComposerBottomBarProps): React.ReactElement {
  return (
    <div className="flex flex-wrap items-start gap-2 px-3 py-2">
      {/* Left side - Model selector + variant + agent */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {showModelSelector && (
          <>
            <ModelChip
              currentModel={currentModel}
              currentVariant={currentVariant}
              isOpen={popoverOpen}
              onClick={onPopoverToggle}
              disabled={!enabled}
              isLoading={modelsLoading && connectedModels.length === 0}
            />
            {currentModel?.variants && currentModel.variants.length > 0 && (
              <VariantSelector
                variants={currentModel.variants}
                currentVariant={currentVariant}
                onSelectVariant={onVariantSelect}
                disabled={!enabled}
              />
            )}
          </>
        )}
        {showAgentChip && (
          <AgentChip
            selectedAgent={selectedAgent}
            defaultAgentName={defaultAgentName}
            isOpen={agentPopoverOpen}
            onClick={onAgentPopoverToggle}
            disabled={!enabled}
          />
        )}
        <RepositoryIndexBadge
          baseDirectory={baseDirectory}
          providerSessionId={providerSessionId}
        />
        {mcpStatus && <McpStatusDropdown {...mcpStatus} />}
      </div>

      {/* Model popover - positioned above the model chip */}
      <ModelPopover
        isOpen={popoverOpen}
        onClose={() => onPopoverToggle()}
        models={connectedModels}
        providers={connectedProviders}
        currentModelId={modelId}
        onSelectModel={onModelSelect}
      />

      {/* Agent popover - positioned above the agent chip */}
      {showAgentChip && (
        <AgentPopover
          open={agentPopoverOpen}
          onOpenChange={onAgentPopoverChange}
          selectedAgent={selectedAgent}
          defaultAgentName={defaultAgentName}
          onDefaultAgentResolved={onDefaultAgentResolved}
          onSelect={onAgentSelect}
          baseDirectory={agentBaseDirectory}
        />
      )}

      {/* Right side - Actions */}
      <div className="ml-auto flex shrink-0 items-center gap-1.5 self-end">
        {/* Doc context toggle — small circular icon button */}
        {onToggleDocContext && (
          <button
            type="button"
            onClick={onToggleDocContext}
            title={docContextEnabled ? 'Docs enabled' : 'Docs disabled'}
            aria-label={
              docContextEnabled ? 'Disable doc context' : 'Enable doc context'
            }
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
              docContextEnabled
                ? 'text-[var(--color-agent)] bg-[color-mix(in_srgb,var(--color-agent)_15%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-agent)_22%,transparent)]'
                : 'text-[var(--color-text-muted)] bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-text)_10%,transparent)] hover:text-[var(--color-text)]'
            }`}
          >
            <DocIcon />
          </button>
        )}

        {/* Attachment button — small circular icon button */}
        <button
          type="button"
          onClick={onFilePicker}
          disabled={!enabled}
          title="Attach file"
          aria-label="Attach file"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)] text-[var(--color-text-muted)] hover:bg-[color-mix(in_srgb,var(--color-text)_10%,transparent)] hover:text-[var(--color-text)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <AttachIcon />
        </button>

        {/* Reply toggle */}
        {showReplyButton && onNoReplyChange && (
          <ReplyToggle
            noReply={noReply}
            onNoReplyChange={onNoReplyChange}
            enabled={enabled}
          />
        )}

        {/* Send button — solid sky-blue circle with white up-arrow. */}
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled}
          title={
            showReplyButton
              ? noReply
                ? 'Queue message (no agent response)'
                : 'Send and trigger agent response'
              : submitLabel
          }
          aria-label={submitLabel}
          className={`flex h-8 w-8 items-center justify-center rounded-full text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            showReplyButton && !noReply
              ? 'bg-[var(--color-user)] hover:bg-[color-mix(in_srgb,var(--color-user)_85%,black)]'
              : 'bg-[var(--color-agent)] hover:bg-[color-mix(in_srgb,var(--color-agent)_85%,black)]'
          }`}
        >
          <ArrowUpIcon />
        </button>
      </div>
    </div>
  );
}

export const ComposerBottomBar = memo(ComposerBottomBarComponent);
