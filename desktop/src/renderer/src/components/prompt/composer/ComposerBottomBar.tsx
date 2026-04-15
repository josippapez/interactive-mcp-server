import { memo } from 'react';
import type { SessionStatus } from '../../../types';
import type { Model } from '../../../hooks/useProviders';
import ModelChip from '../ModelChip';
import ModelPopover from '../ModelPopover';
import VariantSelector from '../VariantSelector';
import { SendIcon, AttachIcon, DocIcon } from './ComposerIcons';
import { ReplyToggle } from './ReplyToggle';
import { StatusDisplay } from './StatusDisplay';
import type { Provider } from '../../../hooks/useProviders';

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
  // Status props
  isBusy: boolean;
  latestStatus: SessionStatus | null | undefined;
  connectionId: string | null | undefined;
  onDismissStatus:
    | ((connectionId: string, timestamp: Date) => void)
    | undefined;
  sendShortcut: string;
  // Doc context props
  docContextEnabled: boolean;
  onToggleDocContext: (() => void) | undefined;
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

/** Bottom toolbar with model selector, status, and action buttons */
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
  isBusy,
  latestStatus,
  connectionId,
  onDismissStatus,
  sendShortcut,
  docContextEnabled,
  onToggleDocContext,
  onFilePicker,
  showReplyButton,
  noReply,
  onNoReplyChange,
  onSubmit,
  disabled,
  submitLabel,
}: ComposerBottomBarProps): React.ReactElement {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-t border-[var(--color-border)]/50">
      {/* Left side - Model selector + variant */}
      <div className="flex items-center gap-1.5 shrink-0">
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

      {/* Center - Status or keyboard hint */}
      <div className="flex-1 flex items-center justify-center min-w-0 overflow-hidden">
        <StatusDisplay
          isBusy={isBusy}
          latestStatus={latestStatus}
          connectionId={connectionId}
          onDismissStatus={onDismissStatus}
          sendShortcut={sendShortcut}
        />
      </div>

      {/* Right side - Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Doc context toggle */}
        {onToggleDocContext && (
          <button
            type="button"
            onClick={onToggleDocContext}
            title={docContextEnabled ? 'Docs enabled' : 'Docs disabled'}
            aria-label={
              docContextEnabled ? 'Disable doc context' : 'Enable doc context'
            }
            className={`p-1.5 rounded-md transition-colors ${
              docContextEnabled
                ? 'text-[var(--color-agent)] bg-[var(--color-agent)]/10'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-alt)]'
            }`}
          >
            <DocIcon />
          </button>
        )}

        {/* Attachment button */}
        <button
          type="button"
          onClick={onFilePicker}
          disabled={!enabled}
          title="Attach file"
          aria-label="Attach file"
          className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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

        {/* Send button */}
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled}
          title={
            showReplyButton
              ? noReply
                ? 'Queue message (no agent response)'
                : 'Send and trigger agent response'
              : `${submitLabel} (${sendShortcut})`
          }
          aria-label={submitLabel}
          className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
            showReplyButton && !noReply
              ? 'bg-[var(--color-user)] text-white hover:opacity-90'
              : 'bg-[var(--color-agent)] text-white hover:opacity-90'
          }`}
        >
          <SendIcon />
          <span className="hidden sm:inline">{submitLabel}</span>
        </button>
      </div>
    </div>
  );
}

export const ComposerBottomBar = memo(ComposerBottomBarComponent);
