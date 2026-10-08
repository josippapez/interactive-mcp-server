import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ReviewDiffFile as ApiReviewDiffFile,
  ReviewDiffSource,
} from '../../../../preload';
import type { Attachment } from '../../types';
import { DiffChanges } from './tool-call/ToolCallShared';
import {
  buildUnifiedDiffRows,
  DIFF_MAX_LINES,
  inferLanguage,
  pairGenericDiffLines,
  SideBySideDiffGrid,
  UnifiedDiffRows,
  type DiffLineCommentTarget,
} from './DiffView';
import {
  formatReviewCommentPrompt,
  getReviewFileIcon,
  normalizeReviewDiffs,
  normalizeReviewPanelWidth,
  parseReviewDiffPatch,
  shouldMountReviewDiff,
  splitReviewPath,
  type ReviewDiffFile,
} from './review-sidebar-utils';

const MAX_DIFF_CHANGED_LINES = 500;

type DiffDisplayMode = 'unified' | 'side-by-side';

export type ReviewSidebarProps = {
  diffs: readonly ApiReviewDiffFile[];
  sessionId: string;
  onSubmitComment?: (
    sessionId: string,
    message: string,
    attachments?: Attachment[],
  ) => void;
  defaultMode?: DiffDisplayMode;
  mobile?: boolean;
  source: ReviewDiffSource;
  sourceOptions: readonly ReviewDiffSource[];
  loading?: boolean;
  error?: string | null;
  onSourceChange: (source: ReviewDiffSource) => void;
  onRefresh?: () => void;
  embedded?: boolean;
};

type CommentDraft = {
  file: string;
  lineNumber: number;
  side: 'old' | 'new';
  preview: string;
};

function statusLabel(status: ReviewDiffFile['status']): string {
  if (status === 'added') return 'Added';
  if (status === 'deleted') return 'Removed';
  return 'Modified';
}

function Chevron({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg
      data-slot="session-review-diff-chevron"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`transition-transform ${open ? 'rotate-180' : ''}`}
    >
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

function ReviewFileName({ file }: { file: string }): React.ReactElement {
  const { directory, filename } = splitReviewPath(file);
  return (
    <div data-slot="session-review-file-name-container">
      {directory && (
        <span data-slot="session-review-directory">{directory}</span>
      )}
      <span data-slot="session-review-filename">{filename}</span>
    </div>
  );
}

function ReviewFileIcon({ file }: { file: string }): React.ReactElement {
  const icon = getReviewFileIcon(file);
  return (
    <span
      data-slot="session-review-file-icon"
      data-tone={icon.tone}
      aria-hidden="true"
    >
      {icon.label}
    </span>
  );
}

function ReviewDiffBody({
  file,
  mode,
  sessionId,
  onSubmitComment,
}: {
  file: ReviewDiffFile;
  mode: DiffDisplayMode;
  sessionId: string;
  onSubmitComment?: ReviewSidebarProps['onSubmitComment'];
}): React.ReactElement {
  const [forceLargeDiff, setForceLargeDiff] = useState(false);
  const [commentDraft, setCommentDraft] = useState<CommentDraft | null>(null);
  const [comment, setComment] = useState('');
  const diffData = useMemo(() => {
    if (!file.patch) return null;
    const lines = parseReviewDiffPatch(file.patch);
    if (lines.length === 0) return null;
    const paired = pairGenericDiffLines(lines, DIFF_MAX_LINES);
    const unified = buildUnifiedDiffRows(lines, DIFF_MAX_LINES);
    return {
      paired,
      unified,
      language: inferLanguage(file.file),
      truncated: paired.truncated || unified.truncated,
      totalRows: Math.max(paired.totalRows, unified.totalRows),
    };
  }, [file.file, file.patch]);
  const changedLines = file.additions + file.deletions;
  const tooLarge = changedLines > MAX_DIFF_CHANGED_LINES && !forceLargeDiff;

  if (!diffData) {
    return (
      <div data-slot="session-review-empty-diff">
        No patch hunks available for this file yet.
      </div>
    );
  }

  if (tooLarge) {
    return (
      <div data-slot="session-review-large-diff">
        <div data-slot="session-review-large-diff-title">Large diff hidden</div>
        <div data-slot="session-review-large-diff-meta">
          This file has {changedLines.toLocaleString()} changed lines. Rendering
          is capped at {MAX_DIFF_CHANGED_LINES.toLocaleString()} by default.
        </div>
        <button type="button" onClick={() => setForceLargeDiff(true)}>
          Render anyway
        </button>
      </div>
    );
  }

  const handleLineComment = (target: DiffLineCommentTarget) => {
    setComment('');
    setCommentDraft({
      file: file.file,
      lineNumber: target.lineNumber,
      side: target.side,
      preview: target.content,
    });
  };

  return (
    <div data-slot="session-review-rendered-diff">
      {mode === 'unified' ? (
        <UnifiedDiffRows
          rows={diffData.unified.rows}
          language={diffData.language}
          onLineComment={handleLineComment}
        />
      ) : (
        <SideBySideDiffGrid
          rows={diffData.paired.rows}
          language={diffData.language}
          onLineComment={handleLineComment}
        />
      )}
      {diffData.truncated && (
        <div data-slot="session-review-empty-diff">
          Showing first {DIFF_MAX_LINES} of {diffData.totalRows} diff rows.
        </div>
      )}
      {commentDraft && (
        <div data-slot="review-comment-editor">
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder={`Comment on line ${commentDraft.lineNumber}`}
            rows={3}
          />
          <div data-slot="review-comment-editor-actions">
            <button type="button" onClick={() => setCommentDraft(null)}>
              Cancel
            </button>
            <button
              type="button"
              disabled={!comment.trim()}
              onClick={() => {
                if (!commentDraft || !onSubmitComment) return;
                onSubmitComment(
                  sessionId,
                  formatReviewCommentPrompt({ ...commentDraft, comment }),
                );
                setComment('');
                setCommentDraft(null);
              }}
            >
              Add comment
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const ReviewSidebar = memo(function ReviewSidebar({
  diffs,
  sessionId,
  onSubmitComment,
  defaultMode = 'side-by-side',
  mobile = false,
  source,
  sourceOptions,
  loading = false,
  error = null,
  onSourceChange,
  onRefresh,
  embedded = false,
}: ReviewSidebarProps): React.ReactElement {
  const normalized = useMemo(() => normalizeReviewDiffs(diffs), [diffs]);
  const [mode, setMode] = useState<DiffDisplayMode>(defaultMode);
  const [panelWidth, setPanelWidth] = useState(() =>
    typeof window === 'undefined'
      ? 620
      : normalizeReviewPanelWidth(620, window.innerWidth),
  );
  const [openFiles, setOpenFiles] = useState<ReadonlySet<string>>(
    () => new Set(normalized.files[0] ? [normalized.files[0].file] : []),
  );
  const [mountedFiles, setMountedFiles] = useState<ReadonlySet<string>>(
    () => new Set(normalized.files[0] ? [normalized.files[0].file] : []),
  );

  useEffect(() => {
    if (normalized.files.length === 0) return;
    setOpenFiles((prev) => {
      const next = new Set(
        [...prev].filter((file) =>
          normalized.files.some((item) => item.file === file),
        ),
      );
      if (next.size === 0) next.add(normalized.files[0].file);
      return next;
    });
    setMountedFiles((prev) => {
      const next = new Set(
        [...prev].filter((file) =>
          normalized.files.some((item) => item.file === file),
        ),
      );
      next.add(normalized.files[0].file);
      return next;
    });
  }, [normalized.files]);

  const handleResizeStart = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (mobile || embedded) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = panelWidth;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const delta = startX - moveEvent.clientX;
        setPanelWidth(
          normalizeReviewPanelWidth(startWidth + delta, window.innerWidth),
        );
      };

      const handlePointerUp = () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    },
    [embedded, mobile, panelWidth],
  );

  const allOpen =
    normalized.files.length > 0 && openFiles.size === normalized.files.length;

  const toggleFile = (file: string) => {
    setOpenFiles((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else {
        next.add(file);
        setMountedFiles((mounted) => new Set(mounted).add(file));
      }
      return next;
    });
  };

  const toggleAll = () => {
    setOpenFiles(
      allOpen ? new Set() : new Set(normalized.files.map((file) => file.file)),
    );
    if (!allOpen) {
      setMountedFiles(
        new Set(normalized.files.slice(0, 2).map((file) => file.file)),
      );
    }
  };

  return (
    <aside
      aria-label="Review changes"
      data-component="session-review-panel"
      data-mobile={mobile ? 'true' : undefined}
      data-embedded={embedded ? 'true' : undefined}
      className={
        embedded
          ? 'min-h-0 flex-1 overflow-hidden bg-[var(--background-base)]'
          : mobile
            ? 'min-h-0 flex-1 overflow-hidden border-t border-[var(--border-weaker-base)] bg-[var(--background-base)] md:hidden'
            : 'relative hidden min-h-0 shrink-0 border-l border-[var(--border-weaker-base)] bg-[var(--background-base)] md:flex'
      }
      style={mobile || embedded ? undefined : { width: panelWidth }}
    >
      {!mobile && !embedded && (
        <button
          type="button"
          data-slot="session-review-resize-handle"
          aria-label="Resize review panel"
          onPointerDown={handleResizeStart}
        />
      )}
      <div
        data-component="session-review"
        className="flex min-w-0 flex-1 flex-col overflow-hidden"
      >
        <div data-slot="session-review-header">
          <div data-slot="session-review-title">Review</div>
          <div data-slot="session-review-actions">
            <div
              data-slot="session-review-source-tabs"
              role="tablist"
              aria-label="Review source"
            >
              {sourceOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="tab"
                  aria-selected={source === option}
                  data-active={source === option ? 'true' : undefined}
                  onClick={() => onSourceChange(option)}
                >
                  {option === 'git'
                    ? 'Git'
                    : option === 'branch'
                      ? 'Branch'
                      : 'Last turn'}
                </button>
              ))}
            </div>
            <div
              data-slot="session-review-diff-style"
              role="group"
              aria-label="Diff style"
            >
              <button
                type="button"
                data-active={mode === 'unified' ? 'true' : undefined}
                onClick={() => setMode('unified')}
              >
                Unified
              </button>
              <button
                type="button"
                data-active={mode === 'side-by-side' ? 'true' : undefined}
                onClick={() => setMode('side-by-side')}
              >
                Split
              </button>
            </div>
            <button
              type="button"
              data-slot="session-review-expand-all"
              onClick={toggleAll}
            >
              {allOpen ? 'Collapse all' : 'Expand all'}
            </button>
            {onRefresh && source !== 'turn' && (
              <button
                type="button"
                data-slot="session-review-expand-all"
                onClick={onRefresh}
              >
                Refresh
              </button>
            )}
          </div>
        </div>

        <div data-slot="session-review-scroll">
          <div data-slot="session-review-container">
            {loading ? (
              <div data-slot="session-review-empty">Loading changes...</div>
            ) : error ? (
              <div data-slot="session-review-empty">{error}</div>
            ) : normalized.files.length === 0 ? (
              <div data-slot="session-review-empty">No review changes yet.</div>
            ) : (
              <div data-slot="session-review-summary">
                <span>
                  {normalized.files.length}{' '}
                  {normalized.files.length === 1 ? 'file' : 'files'} changed
                </span>
                <DiffChanges
                  additions={normalized.totalAdditions}
                  deletions={normalized.totalDeletions}
                />
              </div>
            )}

            <div data-slot="session-review-accordion">
              {normalized.files.map((file, index) => {
                const open = openFiles.has(file.file);
                const mounted = shouldMountReviewDiff({
                  index,
                  open,
                  force: mountedFiles.has(file.file),
                });
                return (
                  <section
                    key={file.id}
                    id={`review-${file.id}`}
                    data-slot="session-review-accordion-item"
                    data-selected={open ? '' : undefined}
                  >
                    <button
                      type="button"
                      data-slot="session-review-trigger"
                      aria-expanded={open}
                      onClick={() => toggleFile(file.file)}
                    >
                      <div data-slot="session-review-trigger-content">
                        <div data-slot="session-review-file-info">
                          <ReviewFileIcon file={file.file} />
                          <ReviewFileName file={file.file} />
                        </div>
                        <div data-slot="session-review-trigger-actions">
                          <span
                            data-slot="session-review-change"
                            data-type={file.status ?? 'modified'}
                          >
                            {statusLabel(file.status)}
                          </span>
                          <DiffChanges
                            additions={file.additions}
                            deletions={file.deletions}
                          />
                          <Chevron open={open} />
                        </div>
                      </div>
                    </button>
                    {open && (
                      <div data-slot="session-review-accordion-content">
                        <div data-slot="session-review-diff-wrapper">
                          {mounted ? (
                            <ReviewDiffBody
                              file={file}
                              mode={mode}
                              sessionId={sessionId}
                              onSubmitComment={onSubmitComment}
                            />
                          ) : (
                            <div data-slot="session-review-diff-placeholder">
                              <span>Diff not rendered yet.</span>
                              <button
                                type="button"
                                onClick={() =>
                                  setMountedFiles((prev) =>
                                    new Set(prev).add(file.file),
                                  )
                                }
                              >
                                Render diff
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
});

export default ReviewSidebar;
