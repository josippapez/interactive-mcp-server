import React, { useState } from 'react';
import ConfirmDeleteModal from '../ConfirmDeleteModal';
import ConfirmAbortModal from '../ConfirmAbortModal';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import type { VcsInfo } from '../../types';

type ParentInfo = {
  id: string;
  title: string;
};

type Props = {
  label: string;
  promptActive: boolean;
  onClearMessages: () => void;
  onRemoveSession: () => void;
  onDismissSession: () => void;
  onAbortSession?: () => void;
  canAbort?: boolean;
  vcsInfo?: VcsInfo | null;
  /** Whether to expand all tool calls by default */
  expandAllTools?: boolean;
  /** Toggle callback for expand all tools */
  onToggleExpandAllTools?: () => void;
  /** Whether to show thinking sections expanded by default */
  showThinking?: boolean;
  /** Toggle callback for show thinking */
  onToggleShowThinking?: () => void;
  /** Parent session info for breadcrumb navigation */
  parentInfo?: ParentInfo | null;
  /** Callback to navigate to parent session */
  onNavigateToParent?: () => void;
};

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
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-sm bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[var(--color-text-faint)] select-none max-w-[180px]">
          <GitBranchIcon />
          <span className="truncate">{vcsInfo.branch ?? 'unknown'}</span>
          {hasChanges && (
            <span className="flex items-center gap-0.5 text-[9px] ml-0.5">
              <span className="text-green-500">+{vcsInfo.additions}</span>
              <span className="text-red-500">-{vcsInfo.deletions}</span>
            </span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
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
  expandAllTools,
  onToggleExpandAllTools,
  showThinking,
  onToggleShowThinking,
  parentInfo,
  onNavigateToParent,
}: Props): React.ReactElement {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmAbort, setConfirmAbort] = useState(false);

  return (
    <>
      <header className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
        <div className="flex items-center gap-2 min-w-0">
          {/* Breadcrumb: show parent link when this is a subagent */}
          {parentInfo && onNavigateToParent && (
            <>
              <button
                type="button"
                onClick={onNavigateToParent}
                className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-agent)] transition-colors cursor-pointer group"
                title={`Go to parent: ${parentInfo.title}`}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="opacity-60 group-hover:opacity-100"
                >
                  <path d="M10 4L6 8l4 4" />
                </svg>
                <span className="truncate max-w-[120px]">
                  {parentInfo.title}
                </span>
              </button>
              <span className="text-[var(--color-text-faint)] opacity-50">
                /
              </span>
            </>
          )}
          <span className="text-[var(--color-text-faint)] select-none">#</span>
          <h2 className="text-sm text-[var(--color-text)] truncate">{label}</h2>
          {promptActive && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-[var(--color-user)]/10 text-[var(--color-user)] select-none">
              pending prompt
            </span>
          )}
          {vcsInfo && <VcsBadge vcsInfo={vcsInfo} />}
        </div>
        <div className="flex items-center gap-0.5">
          {canAbort && onAbortSession && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setConfirmAbort(true)}
                  className="h-7 w-7 text-amber-500/60 hover:text-amber-500 hover:bg-amber-500/10"
                  aria-label="Abort running session"
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
                </Button>
              </TooltipTrigger>
              <TooltipContent>Abort running session</TooltipContent>
            </Tooltip>
          )}
          {onToggleExpandAllTools && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onToggleExpandAllTools}
                  className={`h-7 w-7 text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] ${
                    expandAllTools ? 'text-[var(--color-agent)]' : ''
                  }`}
                  aria-label={
                    expandAllTools ? 'Collapse all tools' : 'Expand all tools'
                  }
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
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {expandAllTools ? 'Collapse all tools' : 'Expand all tools'}
              </TooltipContent>
            </Tooltip>
          )}
          {onToggleShowThinking && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onToggleShowThinking}
                  className={`h-7 w-7 text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] ${
                    showThinking ? 'text-[var(--color-agent)]' : ''
                  }`}
                  aria-label={
                    showThinking
                      ? 'Hide thinking sections'
                      : 'Show thinking sections'
                  }
                >
                  {/* Brain/thinking icon */}
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
                    <path d="M4 8c0-2.2 1.8-4 4-4s4 1.8 4 4" />
                    <path d="M5 11c-.6-.4-1-1.1-1-2" />
                    <path d="M11 11c.6-.4 1-1.1 1-2" />
                    <path d="M6 13c0 .6.4 1 1 1h2c.6 0 1-.4 1-1v-2H6v2z" />
                    <circle cx="6" cy="7" r="0.5" fill="currentColor" />
                    <circle cx="10" cy="7" r="0.5" fill="currentColor" />
                  </svg>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {showThinking
                  ? 'Hide thinking sections'
                  : 'Show thinking sections'}
              </TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClearMessages}
                className="h-7 w-7 text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)]"
                aria-label="Clear message history"
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
              </Button>
            </TooltipTrigger>
            <TooltipContent>Clear message history</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onDismissSession}
                className="h-7 w-7 text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)]"
                aria-label="Close tab from UI"
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
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close tab from UI</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setConfirmDelete(true)}
                className="h-7 w-7 text-[var(--color-error)]/60 hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10"
                aria-label="Remove session channel permanently"
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
              </Button>
            </TooltipTrigger>
            <TooltipContent>Remove session channel permanently</TooltipContent>
          </Tooltip>
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
