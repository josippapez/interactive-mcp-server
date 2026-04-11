import React, { useState } from 'react';
import ConfirmDeleteModal from '../ConfirmDeleteModal';
import ConfirmAbortModal from '../ConfirmAbortModal';
import type { VcsInfo } from '../../types';

type Props = {
  label: string;
  promptActive: boolean;
  onClearMessages: () => void;
  onRemoveSession: () => void;
  onDismissSession: () => void;
  onAbortSession?: () => void;
  canAbort?: boolean;
  vcsInfo?: VcsInfo | null;
  /** Current model ID for OpenCode sessions */
  modelId?: string | null;
  /** Whether to expand all tool calls by default */
  expandAllTools?: boolean;
  /** Toggle callback for expand all tools */
  onToggleExpandAllTools?: () => void;
};

const iconBtn =
  'w-7 h-7 flex items-center justify-center rounded-sm text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors cursor-pointer';

const iconBtnDanger =
  'w-7 h-7 flex items-center justify-center rounded-sm text-[var(--color-error)]/60 hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10 transition-colors cursor-pointer';

const iconBtnWarning =
  'w-7 h-7 flex items-center justify-center rounded-sm text-amber-500/60 hover:text-amber-500 hover:bg-amber-500/10 transition-colors cursor-pointer';

/** Git branch icon */
function GitBranchIcon(): React.ReactElement {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="5" cy="3.5" r="1.5" />
      <circle cx="5" cy="12.5" r="1.5" />
      <circle cx="11" cy="7" r="1.5" />
      <path d="M5 5v6M5 9c0-2.5 2-4 6-4" />
    </svg>
  );
}

/** VCS badge showing branch name and optional change stats */
function VcsBadge({ vcsInfo }: { vcsInfo: VcsInfo }): React.ReactElement {
  const hasChanges =
    vcsInfo.additions > 0 || vcsInfo.deletions > 0 || vcsInfo.files > 0;

  // Build tooltip with stats
  const tooltipParts: string[] = [];
  if (vcsInfo.branch) tooltipParts.push(`Branch: ${vcsInfo.branch}`);
  if (hasChanges) {
    tooltipParts.push(
      `+${vcsInfo.additions} -${vcsInfo.deletions} (${vcsInfo.files} file${vcsInfo.files !== 1 ? 's' : ''})`,
    );
  }
  const tooltip = tooltipParts.join(' | ');

  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-sm bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[var(--color-text-faint)] select-none max-w-[180px]"
      title={tooltip}
    >
      <GitBranchIcon />
      <span className="truncate">{vcsInfo.branch ?? 'unknown'}</span>
      {hasChanges && (
        <span className="flex items-center gap-0.5 text-[9px] ml-0.5">
          <span className="text-green-500">+{vcsInfo.additions}</span>
          <span className="text-red-500">-{vcsInfo.deletions}</span>
        </span>
      )}
    </span>
  );
}

/** Model badge showing the current model ID */
function ModelBadge({ modelId }: { modelId: string }): React.ReactElement {
  // Format the model ID for display - extract the meaningful part
  // e.g., "claude-opus-4-20250514" -> "claude-opus-4"
  // e.g., "gpt-4o" -> "gpt-4o"
  const formatModelId = (id: string): string => {
    // Remove date suffixes (e.g., -20250514)
    const withoutDate = id.replace(/-\d{8}$/, '');
    // Remove version suffixes like -v1, -v2
    const withoutVersion = withoutDate.replace(/-v\d+$/, '');
    return withoutVersion;
  };

  const displayName = formatModelId(modelId);

  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-sm bg-[var(--color-agent)]/10 border border-[var(--color-agent)]/20 text-[var(--color-agent)] select-none max-w-[200px]"
      title={`Model: ${modelId}`}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {/* Brain/AI icon */}
        <circle cx="8" cy="8" r="6" />
        <path d="M5 8h6M8 5v6" />
      </svg>
      <span className="truncate">{displayName}</span>
    </span>
  );
}

export default function ChannelHeader({
  label,
  promptActive,
  onClearMessages,
  onRemoveSession,
  onDismissSession,
  onAbortSession,
  canAbort,
  vcsInfo,
  modelId,
  expandAllTools,
  onToggleExpandAllTools,
}: Props): React.ReactElement {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmAbort, setConfirmAbort] = useState(false);

  return (
    <>
      <header className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[var(--color-text-faint)] select-none">#</span>
          <h2 className="text-sm text-[var(--color-text)] truncate">{label}</h2>
          {modelId && <ModelBadge modelId={modelId} />}
          {promptActive && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-[var(--color-user)]/10 text-[var(--color-user)] select-none">
              pending prompt
            </span>
          )}
          {vcsInfo && <VcsBadge vcsInfo={vcsInfo} />}
        </div>
        <div className="flex items-center gap-0.5">
          {canAbort && onAbortSession && (
            <button
              type="button"
              onClick={() => setConfirmAbort(true)}
              className={iconBtnWarning}
              title="Abort running session"
            >
              {/* Stop/square icon */}
              <svg
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="currentColor"
                stroke="none"
              >
                <rect x="3" y="3" width="10" height="10" rx="1" />
              </svg>
            </button>
          )}
          {onToggleExpandAllTools && (
            <button
              type="button"
              onClick={onToggleExpandAllTools}
              className={
                expandAllTools
                  ? `${iconBtn} text-[var(--color-agent)]`
                  : iconBtn
              }
              title={expandAllTools ? 'Collapse all tools' : 'Expand all tools'}
            >
              {/* Expand/collapse icon - two horizontal lines with arrows */}
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {expandAllTools ? (
                  <>
                    {/* Collapse icon: lines pointing inward */}
                    <path d="M4 4h8" />
                    <path d="M4 12h8" />
                    <path d="M8 6v4" />
                    <path d="M6 7l2-1 2 1" />
                    <path d="M6 11l2-1 2 1" />
                  </>
                ) : (
                  <>
                    {/* Expand icon: lines pointing outward */}
                    <path d="M4 6h8" />
                    <path d="M4 10h8" />
                    <path d="M8 2v4" />
                    <path d="M8 10v4" />
                    <path d="M6 3l2 1 2-1" />
                    <path d="M6 13l2-1 2 1" />
                  </>
                )}
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={onClearMessages}
            className={iconBtn}
            title="Clear message history"
          >
            {/* eraser-ish: lines with strike */}
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 13h12" />
              <path d="M4 10 9 3l4 3-5 7H4z" />
              <path d="M9 3l4 3" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onDismissSession}
            className={iconBtn}
            title="Close tab from UI"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M3 3l10 10M13 3 3 13" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className={iconBtnDanger}
            title="Remove session channel permanently"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 4h10" />
              <path d="M6 4V2h4v2" />
              <path d="M5 4l.5 9h5l.5-9" />
              <path d="M7 7v4M9 7v4" />
            </svg>
          </button>
        </div>
      </header>
      <ConfirmDeleteModal
        open={confirmDelete}
        label={label}
        onConfirm={() => {
          setConfirmDelete(false);
          onRemoveSession();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
      <ConfirmAbortModal
        open={confirmAbort}
        label={label}
        onConfirm={() => {
          setConfirmAbort(false);
          onAbortSession?.();
        }}
        onCancel={() => setConfirmAbort(false)}
      />
    </>
  );
}
