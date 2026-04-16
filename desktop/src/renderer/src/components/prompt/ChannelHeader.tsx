import React, { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
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
  searchQuery?: string;
  searchResultText?: string | null;
  searchOpen?: boolean;
  onSearchOpenChange?: (open: boolean) => void;
  onSearchQueryChange?: (value: string) => void;
  onSearchNext?: () => void;
  onSearchPrevious?: () => void;
  onSearchClear?: () => void;
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
      aria-hidden="true"
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
  searchQuery = '',
  searchResultText = null,
  searchOpen = false,
  onSearchOpenChange,
  onSearchQueryChange,
  onSearchNext,
  onSearchPrevious,
  onSearchClear,
}: Props): React.ReactElement {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmAbort, setConfirmAbort] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [searchOpen]);

  return (
    <>
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]/95 px-3 py-2 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex min-w-0 items-center gap-2.5">
              {/* Breadcrumb: show parent link when this is a subagent */}
              {parentInfo && onNavigateToParent && (
                <>
                  <button
                    type="button"
                    onClick={onNavigateToParent}
                    className="group flex items-center gap-1 text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-agent)]"
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
                      aria-hidden="true"
                    >
                      <path d="M10 4L6 8l4 4" />
                    </svg>
                    <span className="max-w-[120px] truncate">{parentInfo.title}</span>
                  </button>
                  <span className="text-[var(--color-text-faint)] opacity-50">/</span>
                </>
              )}
              <span className="select-none text-[var(--color-text-faint)]">#</span>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-[var(--color-text)]">
                  {label}
                </h2>
              </div>
              {promptActive && (
                <span className="select-none rounded-full border border-[var(--color-user)]/20 bg-[var(--color-user)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-user)]">
                  pending prompt
                </span>
              )}
              {vcsInfo && vcsInfo.branch && <VcsBadge vcsInfo={vcsInfo} />}
            </div>
            {onSearchQueryChange && searchOpen && (
              <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/90 px-2.5 py-1.5 shadow-sm max-w-3xl">
                <div className="relative min-w-0 flex-1">
                  <Input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => onSearchQueryChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (e.shiftKey) {
                          onSearchPrevious?.();
                        } else {
                          onSearchNext?.();
                        }
                        return;
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        onSearchClear?.();
                        onSearchOpenChange?.(false);
                      }
                    }}
                    placeholder="Find in this session"
                    aria-label="Search messages in current channel"
                    className="h-8 border-0 bg-transparent pl-8 pr-8 text-xs shadow-none focus-visible:ring-0"
                  />
                  <svg
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-faint)]"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="7" cy="7" r="4.5" />
                    <path d="m10.5 10.5 3 3" />
                  </svg>
                  {searchQuery && onSearchClear && (
                    <button
                      type="button"
                      onClick={onSearchClear}
                      className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-[var(--color-text-faint)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
                      aria-label="Clear channel search"
                    >
                      ×
                    </button>
                  )}
                </div>
                <span className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-2 py-1 text-[10px] font-medium text-[var(--color-text-faint)]">
                  {searchResultText ?? '0 / 0'}
                </span>
                <button
                  type="button"
                  onClick={onSearchPrevious}
                  className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
                  aria-label="Previous search result"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={onSearchNext}
                  className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
                  aria-label="Next search result"
                >
                  ↓
                </button>
                <kbd className="hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-1.5 py-1 font-mono text-[10px] text-[var(--color-text-faint)] sm:inline-flex">
                  {navigator.platform.toLowerCase().includes('mac') ? 'Esc' : 'Esc'}
                </kbd>
                <button
                  type="button"
                  onClick={() => {
                    onSearchClear?.();
                    onSearchOpenChange?.(false);
                  }}
                  className="rounded-md border border-transparent px-2 py-1 text-[10px] text-[var(--color-text-faint)] transition-colors hover:border-[var(--color-border)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)]"
                  aria-label="Close channel search"
                >
                  Close
                </button>
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/80 p-1 shadow-sm">
            {onSearchQueryChange && onSearchOpenChange && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onSearchOpenChange(!searchOpen)}
                    className={`h-7 w-7 hover:bg-[var(--color-border)] ${
                      searchOpen
                        ? 'text-[var(--color-agent)]'
                        : 'text-[var(--color-text-faint)] hover:text-[var(--color-text)]'
                    }`}
                    aria-label={searchOpen ? 'Hide channel search' : 'Show channel search'}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <circle cx="7" cy="7" r="4.5" />
                      <path d="m10.5 10.5 3 3" />
                    </svg>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Find in session</TooltipContent>
              </Tooltip>
            )}
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
                    aria-hidden="true"
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
                    aria-hidden="true"
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
                    aria-hidden="true"
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
                  aria-hidden="true"
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
                  aria-hidden="true"
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
                  aria-hidden="true"
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
