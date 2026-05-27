import React, { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import ConfirmDeleteModal from '../ConfirmDeleteModal';
import ConfirmAbortModal from '../ConfirmAbortModal';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import type { VcsInfo } from '../../types';
import { CHAT_TEXT_SIZE_OPTIONS, type ChatTextSize } from './chat-text-size';
import { useMessageCopy } from './useMessageCopy';

type ParentInfo = {
  id: string;
  title: string;
};

type Props = {
  label: string;
  sessionId?: string | null;
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
  chatTextSize?: ChatTextSize;
  onChatTextSizeChange?: (value: ChatTextSize) => void;
  chatFullWidth?: boolean;
  onToggleChatFullWidth?: () => void;
  /**
   * Copy the full session transcript to the clipboard as Markdown.
   * Resolves to `true` on success, `false` on failure or empty transcript.
   */
  onCopyTranscript?: () => Promise<boolean>;
  onOpenSessionLog?: () => Promise<boolean>;
  onCopySessionLogPath?: () => Promise<boolean>;
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
  /**
   * Whether the floating Tasks panel is currently open. Omit to hide the
   * Tasks toggle button (e.g. for non-OpenCode sessions).
   */
  tasksOpen?: boolean;
  /** Toggle callback for the Tasks panel. */
  onToggleTasks?: () => void;
  /** Active task count, displayed as a badge on the toggle when > 0. */
  activeTaskCount?: number;
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
      <TooltipTrigger
        render={
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-sm bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[var(--color-text-faint)] select-none max-w-[180px]">
            <GitBranchIcon />
            <span className="truncate">{vcsInfo.branch ?? 'unknown'}</span>
            {hasChanges && (
              <span className="flex items-center gap-0.5 text-[9px] ml-0.5">
                <span className="text-[var(--text-on-success)]">
                  +{vcsInfo.additions}
                </span>
                <span className="text-[var(--text-on-critical)]">
                  -{vcsInfo.deletions}
                </span>
              </span>
            )}
          </span>
        }
      />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function ChannelHeader({
  label,
  sessionId,
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
  chatTextSize = 'md',
  onChatTextSizeChange,
  chatFullWidth = false,
  onToggleChatFullWidth,
  onCopyTranscript,
  onOpenSessionLog,
  onCopySessionLogPath,
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
  tasksOpen = false,
  onToggleTasks,
  activeTaskCount = 0,
}: Props): React.ReactElement {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmAbort, setConfirmAbort] = useState(false);
  const [transcriptCopied, setTranscriptCopied] = useState(false);
  const [logPathCopied, setLogPathCopied] = useState(false);
  const { copied: sessionIdCopied, copy: copySessionId } = useMessageCopy();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // When the sidebar is collapsed, the header's leftmost UI (SidebarTrigger)
  // would slide under the macOS traffic-lights. Add ~72px left padding to
  // clear the traffic-light zone (window.ts trafficLightPosition.x = 15 + 3
  // buttons each ~14px wide with gaps).
  const { state: sidebarState } = useSidebar();
  const sidebarCollapsed = sidebarState === 'collapsed';

  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [searchOpen]);

  return (
    <>
      {/*
        ChannelHeader sits flush at y=0; its top edge visually overlaps the
        macOS titlebar zone. The header element itself is `titlebar-drag` so
        empty pixels act as a window drag handle. The inner content wrapper is
        `titlebar-no-drag` so all buttons/inputs/links inside remain clickable.
        This is the standard Electron pattern (drag on parent, no-drag on
        interactive children) and avoids overlay z-index conflicts.
      */}
      <header
        className={`titlebar-drag border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]/95 ${sidebarCollapsed ? 'pl-[80px]' : 'px-3'} ${sidebarCollapsed ? 'pr-3' : ''} py-2 backdrop-blur-sm`}
      >
        <div className="flex min-w-0 flex-wrap items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
              <SidebarTrigger className="h-7 w-7 shrink-0 rounded-md text-[var(--color-text-faint)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]" />
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
                    <span className="max-w-[120px] truncate">
                      {parentInfo.title}
                    </span>
                  </button>
                  <span className="text-[var(--color-text-faint)] opacity-50">
                    /
                  </span>
                </>
              )}
              {promptActive && (
                <span className="select-none rounded-full border border-[var(--color-user)]/20 bg-[var(--color-user)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-user)]">
                  pending prompt
                </span>
              )}
              {vcsInfo && vcsInfo.branch && <VcsBadge vcsInfo={vcsInfo} />}
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <span className="select-none text-[var(--color-text-faint)]">
                #
              </span>
              <h2 className="min-w-0 truncate text-sm font-semibold text-[var(--color-text)]">
                {label}
              </h2>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/80 p-1 shadow-sm">
            {onToggleTasks && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={onToggleTasks}
                      className={`relative h-7 w-7 hover:bg-[var(--color-border)] ${
                        tasksOpen
                          ? 'text-[var(--color-agent)]'
                          : 'text-[var(--color-text-faint)] hover:text-[var(--color-text)]'
                      }`}
                      aria-label={
                        tasksOpen ? 'Hide tasks panel' : 'Show tasks panel'
                      }
                      aria-pressed={tasksOpen}
                    >
                      {/* Checklist icon */}
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
                        <path d="M2.5 4l1.5 1.5L6.5 3" />
                        <path d="M2.5 8l1.5 1.5L6.5 7" />
                        <path d="M2.5 12l1.5 1.5L6.5 11" />
                        <path d="M9 4h5" />
                        <path d="M9 8h5" />
                        <path d="M9 12h5" />
                      </svg>
                      {activeTaskCount > 0 && (
                        <span
                          aria-hidden="true"
                          className="absolute -right-0.5 -top-0.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--color-user)] px-1 text-[9px] font-semibold leading-none text-white"
                        >
                          {activeTaskCount > 99 ? '99+' : activeTaskCount}
                        </span>
                      )}
                    </Button>
                  }
                />
                <TooltipContent>
                  {tasksOpen
                    ? 'Hide tasks panel'
                    : `Show tasks panel${activeTaskCount > 0 ? ` (${activeTaskCount} active)` : ''}`}
                </TooltipContent>
              </Tooltip>
            )}
            {onSearchQueryChange && onSearchOpenChange && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onSearchOpenChange(!searchOpen)}
                      className={`h-7 w-7 hover:bg-[var(--color-border)] ${
                        searchOpen
                          ? 'text-[var(--color-agent)]'
                          : 'text-[var(--color-text-faint)] hover:text-[var(--color-text)]'
                      }`}
                      aria-label={
                        searchOpen
                          ? 'Hide channel search'
                          : 'Show channel search'
                      }
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
                  }
                />
                <TooltipContent>Find in session</TooltipContent>
              </Tooltip>
            )}
            {canAbort && onAbortSession && (
              <Tooltip>
                <TooltipTrigger
                  render={
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
                  }
                />
                <TooltipContent>Abort running session</TooltipContent>
              </Tooltip>
            )}
            {onToggleExpandAllTools && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={onToggleExpandAllTools}
                      className={`h-7 w-7 text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] ${
                        expandAllTools ? 'text-[var(--color-agent)]' : ''
                      }`}
                      aria-label={
                        expandAllTools
                          ? 'Collapse all tools'
                          : 'Expand all tools'
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
                  }
                />
                <TooltipContent>
                  {expandAllTools ? 'Collapse all tools' : 'Expand all tools'}
                </TooltipContent>
              </Tooltip>
            )}
            {sessionId && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        if (sessionId) {
                          void copySessionId(sessionId);
                        }
                      }}
                      className={`h-7 w-7 text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] ${
                        sessionIdCopied ? 'text-[var(--color-agent)]' : ''
                      }`}
                      aria-label="Copy session ID"
                      disabled={!sessionId}
                    >
                      {sessionIdCopied ? (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M3 8l3 3 7-7" />
                        </svg>
                      ) : (
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
                          <rect x="5" y="5" width="9" height="9" rx="1.5" />
                          <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
                        </svg>
                      )}
                    </Button>
                  }
                />
                <TooltipContent>
                  {sessionIdCopied ? 'Copied!' : 'Copy session ID'}
                </TooltipContent>
              </Tooltip>
            )}
            {onOpenSessionLog && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void onOpenSessionLog()}
                      className="h-7 w-7 text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)]"
                      aria-label="Open session log"
                    >
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
                        <path d="M3 2.5h6l4 4v7A1.5 1.5 0 0 1 11.5 15h-7A1.5 1.5 0 0 1 3 13.5v-11Z" />
                        <path d="M9 2.5V6a.5.5 0 0 0 .5.5H13" />
                        <path d="M5.5 9h5M5.5 11.5h5" />
                      </svg>
                    </Button>
                  }
                />
                <TooltipContent>Open session log</TooltipContent>
              </Tooltip>
            )}
            {onCopySessionLogPath && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={async () => {
                        const ok = await onCopySessionLogPath();
                        if (ok) {
                          setLogPathCopied(true);
                          window.setTimeout(
                            () => setLogPathCopied(false),
                            1500,
                          );
                        }
                      }}
                      className={`h-7 w-7 text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] ${
                        logPathCopied ? 'text-[var(--color-agent)]' : ''
                      }`}
                      aria-label="Copy session log path"
                    >
                      {logPathCopied ? (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M3 8l3 3 7-7" />
                        </svg>
                      ) : (
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
                          <path d="M6 8h4" />
                          <path d="M7 5.5 4.5 8 7 10.5" />
                          <path d="m9 5.5 2.5 2.5L9 10.5" />
                          <rect x="2" y="2" width="12" height="12" rx="2" />
                        </svg>
                      )}
                    </Button>
                  }
                />
                <TooltipContent>
                  {logPathCopied ? 'Copied!' : 'Copy log path'}
                </TooltipContent>
              </Tooltip>
            )}
            {onCopyTranscript && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={async () => {
                        const ok = await onCopyTranscript();
                        if (ok) {
                          setTranscriptCopied(true);
                          window.setTimeout(
                            () => setTranscriptCopied(false),
                            1500,
                          );
                        }
                      }}
                      className={`h-7 w-7 text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] ${
                        transcriptCopied ? 'text-[var(--color-agent)]' : ''
                      }`}
                      aria-label="Copy full session transcript as Markdown"
                    >
                      {transcriptCopied ? (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M3 8l3 3 7-7" />
                        </svg>
                      ) : (
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
                          <rect x="5" y="5" width="9" height="9" rx="1.5" />
                          <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
                        </svg>
                      )}
                    </Button>
                  }
                />
                <TooltipContent>
                  {transcriptCopied ? 'Copied!' : 'Copy session as Markdown'}
                </TooltipContent>
              </Tooltip>
            )}
            {onToggleShowThinking && (
              <Tooltip>
                <TooltipTrigger
                  render={
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
                  }
                />
                <TooltipContent>
                  {showThinking
                    ? 'Hide thinking sections'
                    : 'Show thinking sections'}
                </TooltipContent>
              </Tooltip>
            )}
            {onChatTextSizeChange && (
              <div className="ml-1 flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-1 py-1">
                {CHAT_TEXT_SIZE_OPTIONS.map((size) => {
                  const active = chatTextSize === size;
                  const label =
                    size === 'sm' ? 'A-' : size === 'lg' ? 'A+' : 'A';

                  return (
                    <button
                      key={size}
                      type="button"
                      onClick={() => onChatTextSizeChange(size)}
                      className={`flex h-7 min-w-7 items-center justify-center rounded-md px-2 text-[11px] transition-colors ${
                        active
                          ? 'bg-[var(--color-agent)]/14 text-[var(--color-agent)]'
                          : 'text-[var(--color-text-faint)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]'
                      }`}
                      aria-label={`Set chat text size to ${size}`}
                      title={`Chat text size: ${size}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
            {onToggleChatFullWidth && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={onToggleChatFullWidth}
                      className={`h-7 w-7 text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] ${
                        chatFullWidth ? 'text-[var(--color-agent)]' : ''
                      }`}
                      aria-label={
                        chatFullWidth
                          ? 'Use constrained chat width'
                          : 'Use full-width chat'
                      }
                    >
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
                        {chatFullWidth ? (
                          <>
                            <path d="M2.5 5.5V2.5h3" />
                            <path d="M13.5 5.5V2.5h-3" />
                            <path d="M2.5 10.5v3h3" />
                            <path d="M13.5 10.5v3h-3" />
                          </>
                        ) : (
                          <>
                            <path d="M5.5 2.5h-3v3" />
                            <path d="M10.5 2.5h3v3" />
                            <path d="M5.5 13.5h-3v-3" />
                            <path d="M10.5 13.5h3v-3" />
                          </>
                        )}
                      </svg>
                    </Button>
                  }
                />
                <TooltipContent>
                  {chatFullWidth
                    ? 'Use constrained chat width'
                    : 'Use full-width chat'}
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger
                render={
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
                }
              />
              <TooltipContent>Clear message history</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
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
                }
              />
              <TooltipContent>Close tab from UI</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
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
                }
              />
              <TooltipContent>
                Remove session channel permanently
              </TooltipContent>
            </Tooltip>
          </div>
          {onSearchQueryChange && searchOpen && (
            <div className="flex min-w-0 basis-full items-center gap-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/90 px-2.5 py-1.5 shadow-sm">
              <div className="relative min-w-0 flex-1">
                <Input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    onSearchQueryChange(e.target.value)
                  }
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
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
              <span className="shrink-0 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-2 py-1 text-[10px] font-medium text-[var(--color-text-faint)]">
                {searchResultText ?? '0 / 0'}
              </span>
              <button
                type="button"
                onClick={onSearchPrevious}
                className="shrink-0 rounded-md border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
                aria-label="Previous search result"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={onSearchNext}
                className="shrink-0 rounded-md border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
                aria-label="Next search result"
              >
                ↓
              </button>
              <kbd className="hidden shrink-0 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-1.5 py-1 font-mono text-[10px] text-[var(--color-text-faint)] sm:inline-flex">
                Esc
              </kbd>
              <button
                type="button"
                onClick={() => {
                  onSearchClear?.();
                  onSearchOpenChange?.(false);
                }}
                className="shrink-0 rounded-md border border-transparent px-2 py-1 text-[10px] text-[var(--color-text-faint)] transition-colors hover:border-[var(--color-border)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)]"
                aria-label="Close channel search"
              >
                Close
              </button>
            </div>
          )}
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

export default React.memo(ChannelHeader);
