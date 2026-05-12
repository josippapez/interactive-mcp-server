/**
 * prompt-event-forwarder.ts — out-of-band IPC forwarders for permission
 * and question prompt events.
 *
 * Background
 * ──────────
 * The C6 streaming rewrite routed every SSE payload through the
 * coalesce/batch pipeline (`conversation-batch`). Permission and question
 * prompts are *control-plane* signals — the user needs to see them
 * immediately, not after a 16 ms flush window that may also coalesce
 * unrelated conversation-data events. They also carry routing fields
 * (`connectionId`, `providerSessionId`) that the legacy dedicated
 * channels exposed directly.
 *
 * This module restores the pre-rewrite behaviour for those four events
 * by mirroring the same out-of-band dispatch pattern already used for
 * `session.created/updated/deleted` in `event-stream.ts`:
 *
 *   - `permission.asked`   → IPC `permission-asked`   (after auto-approve
 *                                                      short-circuit)
 *   - `permission.replied` → IPC `permission-replied`
 *   - `question.asked`     → IPC `question-asked`
 *   - `question.replied` / `question.rejected`
 *                          → IPC `question-cleared`
 *
 * Note on the `question-cleared` channel: the preload bridge
 * (`desktop/src/preload/api/events.ts`) listens on `question-cleared`,
 * not `question-replied`. Both `question.replied` and `question.rejected`
 * SDK events collapse to that single clear-signal on the renderer side
 * (matching the pre-rewrite forwarder behaviour). The function name
 * `forwardQuestionReplied` reflects the SDK event; the channel name
 * matches the preload contract.
 *
 * All forwarders are pure with respect to their `ctx`: they do not read
 * settings, touch the database, or construct BrowserWindows directly.
 * That keeps them trivially unit-testable with a mocked `ctx`.
 */

import { replyToOpenCodePermission } from './permission-reply';
import {
  isFileReadPermission,
  shouldAutoApprovePermission,
  shouldAutoApproveReadPermission,
} from './permission-auto-approve';
import { createLogger } from '../../utils/logger';
import { writeSessionLog } from '../../utils/session-logger';
import { getSettingsSnapshot } from './settings-mirror';
import { formatQuestionLifecycleLog } from './question-lifecycle-logger';

const log = createLogger('prompt-event-forwarder');

// ─── Context ─────────────────────────────────────────────────────────────────

/**
 * Minimal context passed to each forwarder. Kept free of Electron / DB
 * imports so tests can inject a trivial mock.
 */
export type PromptForwarderContext = {
  /**
   * Emit a `to-renderer` envelope via the Bridge. Replaces the pre-Phase-2
   * `getWindow().webContents.send(channel, frame)` path; the main-side
   * supervisor forwards these envelopes to the focused BrowserWindow.
   *
   * Returning `void` matches the pre-existing best-effort semantics —
   * event loss during renderer unmount is non-fatal.
   */
  sendToRenderer: (channel: string, payload: unknown) => void;
  /**
   * Resolve the MCP transport `connectionId` for a given provider session.
   * Returns `{ connectionId: null }` when no MCP transport is bound
   * (matches the Phase 6 routing contract — renderer keys on
   * `providerSessionId`).
   */
  resolveConnection: (
    sessionId: string,
  ) =>
    | { connectionId: string | null }
    | Promise<{ connectionId: string | null }>;
  /** Optional — required for auto-approve; typed as `readonly` so tests can pass literals. */
  getAllowedPermissions?: () => readonly string[];
  getAllowedReadFolders?: () => readonly string[];
  /** Optional — port for the OpenCode HTTP server (auto-approve reply POST). */
  getOpenCodePort?: () => number;
};

// ─── Payload shapes ──────────────────────────────────────────────────────────

export type PermissionAskedPayload = {
  sessionID?: string;
  id?: string;
  permission?: string;
  patterns?: string[];
  always?: string[];
  tool?: { messageID: string; callID: string };
  metadata?: Record<string, unknown>;
  directory?: string;
};

export type PermissionRepliedPayload = {
  sessionID?: string;
  requestID?: string;
  reply?: 'once' | 'always' | 'reject';
};

export type QuestionOption = { label: string; description?: string };
export type QuestionSpec = {
  question: string;
  header: string;
  options: QuestionOption[];
  multiple: boolean;
  custom: boolean;
};

export type QuestionAskedPayload = {
  sessionID?: string;
  id?: string;
  questions?: QuestionSpec[];
  tool?: { messageID: string; callID: string };
};

export type QuestionRepliedPayload = {
  sessionID?: string;
  requestID?: string;
  /** Provided for `question.replied`. */
  answer?: string;
  /** When true the SDK event was `question.rejected`. */
  rejected?: boolean;
};

// ─── IPC frame shapes (exported for tests) ───────────────────────────────────

export type PermissionAskedFrame = {
  connectionId: string | null;
  providerSessionId: string;
  requestId: string;
  sessionID: string;
  permission: string;
  patterns?: string[];
  always?: string[];
  tool?: { messageID: string; callID: string };
  metadata?: Record<string, unknown>;
  directory?: string;
};

export type PermissionRepliedFrame = {
  connectionId: string | null;
  providerSessionId: string;
  sessionID: string;
  requestID: string;
  reply: 'once' | 'always' | 'reject';
};

export type QuestionAskedFrame = {
  connectionId: string | null;
  providerSessionId: string;
  requestId: string;
  sessionID: string;
  questions: QuestionSpec[];
  tool?: { messageID: string; callID: string };
};

export type QuestionClearedFrame = {
  connectionId: string | null;
  providerSessionId: string;
  requestId: string;
  sessionID: string;
  answer?: string;
  rejected?: boolean;
};

// ─── Pure frame builders (exported for tests) ────────────────────────────────

export function buildPermissionAskedFrame(
  payload: PermissionAskedPayload,
  connectionId: string | null,
): PermissionAskedFrame | null {
  const sessionID = payload.sessionID;
  const requestId = payload.id;
  const permission = payload.permission;
  if (!sessionID || !requestId || !permission) return null;
  return {
    connectionId,
    providerSessionId: sessionID,
    requestId,
    sessionID,
    permission,
    patterns: payload.patterns,
    always: payload.always,
    tool: payload.tool,
    metadata: payload.metadata,
    directory: payload.directory,
  };
}

export function buildPermissionRepliedFrame(
  payload: PermissionRepliedPayload,
  connectionId: string | null,
): PermissionRepliedFrame | null {
  const sessionID = payload.sessionID;
  const requestID = payload.requestID;
  const reply = payload.reply;
  if (!sessionID || !requestID || !reply) return null;
  return {
    connectionId,
    providerSessionId: sessionID,
    sessionID,
    requestID,
    reply,
  };
}

export function buildQuestionAskedFrame(
  payload: QuestionAskedPayload,
  connectionId: string | null,
): QuestionAskedFrame | null {
  const sessionID = payload.sessionID;
  const requestId = payload.id;
  const questions = payload.questions;
  if (!sessionID || !requestId || !questions || questions.length === 0) {
    return null;
  }
  return {
    connectionId,
    providerSessionId: sessionID,
    requestId,
    sessionID,
    questions,
    tool: payload.tool,
  };
}

export function buildQuestionClearedFrame(
  payload: QuestionRepliedPayload,
  connectionId: string | null,
): QuestionClearedFrame | null {
  const sessionID = payload.sessionID;
  const requestId = payload.requestID;
  if (!sessionID || !requestId) return null;
  return {
    connectionId,
    providerSessionId: sessionID,
    requestId,
    sessionID,
    answer: payload.answer,
    rejected: payload.rejected,
  };
}

// ─── Internal send helper ────────────────────────────────────────────────────

function send(
  ctx: PromptForwarderContext,
  channel: string,
  frame: unknown,
): void {
  try {
    ctx.sendToRenderer(channel, frame);
  } catch (err) {
    log.warn(`Failed to send ${channel}: ${String(err)}`);
  }
}

// ─── Public forwarders ───────────────────────────────────────────────────────

/**
 * Forward a `permission.asked` SSE payload to the renderer.
 *
 * Runs the existing auto-approve helpers first. When the request is
 * auto-approved, replies via `replyToOpenCodePermission` and skips the
 * IPC send (the renderer must never see an auto-approved prompt).
 *
 * Returns `true` when the request was auto-approved and replied to.
 */
export async function forwardPermissionAsked(
  payload: PermissionAskedPayload,
  ctx: PromptForwarderContext,
): Promise<boolean> {
  const sessionID = payload.sessionID;
  const requestId = payload.id;
  const permission = payload.permission;
  if (!sessionID || !requestId || !permission) return false;

  const allowedFolders = ctx.getAllowedReadFolders?.() ?? [];
  const allowedPermissions = ctx.getAllowedPermissions?.() ?? [];

  let autoApprove = false;
  if (
    isFileReadPermission(permission) &&
    shouldAutoApproveReadPermission(payload.patterns, allowedFolders)
  ) {
    autoApprove = true;
    log.info(
      `auto-approving read permission request=${requestId} session=${sessionID} from allowed folders`,
    );
  } else if (shouldAutoApprovePermission(permission, allowedPermissions)) {
    autoApprove = true;
    log.info(
      `auto-approving permission request=${requestId} session=${sessionID} permission=${permission} from allowed permissions`,
    );
  }

  if (autoApprove) {
    const port = ctx.getOpenCodePort?.() ?? 4096;
    try {
      await replyToOpenCodePermission(
        port,
        sessionID,
        requestId,
        'always',
        payload.directory,
      );
    } catch {
      // Best-effort — the renderer will surface the prompt if the reply fails.
    }
    return true;
  }

  const { connectionId } = await ctx.resolveConnection(sessionID);
  const frame = buildPermissionAskedFrame(payload, connectionId);
  if (!frame) return false;

  log.info(
    `permission.asked session=${sessionID} request=${requestId} permission=${permission} connection=${connectionId ?? 'null'}`,
  );
  send(ctx, 'permission-asked', frame);
  return false;
}

/**
 * Forward a `permission.replied` SSE payload to the renderer.
 */
export function forwardPermissionReplied(
  payload: PermissionRepliedPayload,
  ctx: PromptForwarderContext,
): void {
  const sessionID = payload.sessionID;
  if (!sessionID) return;
  void Promise.resolve(ctx.resolveConnection(sessionID)).then(
    ({ connectionId }) => {
      const frame = buildPermissionRepliedFrame(payload, connectionId);
      if (!frame) return;
      log.info(
        `permission.replied session=${sessionID} request=${frame.requestID} reply=${frame.reply}`,
      );
      send(ctx, 'permission-replied', frame);
    },
  );
}

/**
 * Forward a `question.asked` SSE payload to the renderer.
 */
export function forwardQuestionAsked(
  payload: QuestionAskedPayload,
  ctx: PromptForwarderContext,
): void {
  const sessionID = payload.sessionID;
  if (!sessionID) return;
  void Promise.resolve(ctx.resolveConnection(sessionID)).then(
    ({ connectionId }) => {
      const frame = buildQuestionAskedFrame(payload, connectionId);
      if (!frame) return;
      log.info(
        `question.asked session=${sessionID} request=${frame.requestId} connection=${connectionId ?? 'null'} questions=${frame.questions.length}`,
      );
      writeSessionLog(
        getSettingsSnapshot().logsDir,
        sessionID,
        'INFO',
        'question-lifecycle',
        formatQuestionLifecycleLog({
          kind: 'asked',
          requestId: frame.requestId,
          sessionId: sessionID,
          questionCount: frame.questions.length,
        }),
      );
      send(ctx, 'question-asked', frame);
      writeSessionLog(
        getSettingsSnapshot().logsDir,
        sessionID,
        'INFO',
        'question-lifecycle',
        formatQuestionLifecycleLog({
          kind: 'displayed',
          requestId: frame.requestId,
          sessionId: sessionID,
        }),
      );
    },
  );
}

/**
 * Forward a `question.replied` or `question.rejected` SSE payload to the
 * renderer as a single `question-cleared` IPC frame. The preload bridge
 * collapses both SDK outcomes onto the same channel.
 */
export function forwardQuestionReplied(
  payload: QuestionRepliedPayload,
  ctx: PromptForwarderContext,
): void {
  const sessionID = payload.sessionID;
  if (!sessionID) return;
  void Promise.resolve(ctx.resolveConnection(sessionID)).then(
    ({ connectionId }) => {
      const frame = buildQuestionClearedFrame(payload, connectionId);
      if (!frame) return;
      log.info(
        `question.cleared session=${sessionID} request=${frame.requestId} rejected=${String(frame.rejected ?? false)}`,
      );
      writeSessionLog(
        getSettingsSnapshot().logsDir,
        sessionID,
        'INFO',
        'question-lifecycle',
        formatQuestionLifecycleLog({
          kind: 'cleared',
          requestId: frame.requestId,
          sessionId: sessionID,
          reason: frame.rejected ? 'rejected' : 'replied',
        }),
      );
      send(ctx, 'question-cleared', frame);
    },
  );
}
