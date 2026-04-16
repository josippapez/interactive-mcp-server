/**
 * Centralized session-scoped OpenCode SDK wrapper.
 *
 * Every `client.session.*` call in this app flows through this module.
 * When `@opencode-ai/sdk` changes its call shape (as happened in v2),
 * ONLY this file needs to be updated — call sites stay stable.
 *
 * Contract:
 * - Returns the raw SDK response `{ data, error, response }`.
 * - Never throws on `response.error` — callers handle errors themselves.
 * - `opts.directory` is forwarded to `getClient` to select the per-workspace client.
 * - `opts.signal` is forwarded as the 2nd `options` arg to the SDK call.
 */

import { getClient } from './sdk-client';

/**
 * Shared options for every session-API wrapper.
 * `directory` is passed to `getClient` to select the per-workspace SDK client.
 * `signal` is forwarded as the 2nd `options` arg to the SDK call.
 */
export interface SessionApiOpts {
  directory?: string;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Body/query shapes — mirror the SDK v2 parameter types (minus sessionID,
// directory, workspace which are handled by the wrapper itself).
// ---------------------------------------------------------------------------

export interface SessionListQuery {
  roots?: boolean;
  start?: number;
  search?: string;
  limit?: number;
  workspace?: string;
}

export interface SessionCreateBody {
  parentID?: string;
  title?: string;
  permission?: Parameters<
    ReturnType<typeof getClient>['session']['create']
  >[0] extends infer P
    ? P extends { permission?: infer R }
      ? R
      : never
    : never;
  workspaceID?: string;
  workspace?: string;
}

export interface SessionUpdateBody {
  title?: string;
  permission?: SessionCreateBody['permission'];
  time?: { archived?: number };
  workspace?: string;
}

export interface SessionMessagesQuery {
  limit?: number;
  before?: string;
  workspace?: string;
}

export interface SessionSummarizeBody {
  providerID?: string;
  modelID?: string;
  auto?: boolean;
  workspace?: string;
}

export interface SessionForkBody {
  messageID?: string;
  workspace?: string;
}

export interface SessionDiffBody {
  messageID?: string;
  workspace?: string;
}

export interface SessionInitBody {
  modelID?: string;
  providerID?: string;
  messageID?: string;
  workspace?: string;
}

export interface SessionRevertBody {
  messageID?: string;
  partID?: string;
  workspace?: string;
}

export interface SessionModelRef {
  providerID: string;
  modelID: string;
}

export interface SessionPromptBody {
  messageID?: string;
  model?: SessionModelRef;
  agent?: string;
  noReply?: boolean;
  tools?: { [key: string]: boolean };
  format?: Parameters<
    ReturnType<typeof getClient>['session']['prompt']
  >[0] extends infer P
    ? P extends { format?: infer R }
      ? R
      : never
    : never;
  system?: string;
  variant?: string;
  parts?: Parameters<
    ReturnType<typeof getClient>['session']['prompt']
  >[0] extends infer P
    ? P extends { parts?: infer R }
      ? R
      : never
    : never;
  workspace?: string;
}

export interface SessionCommandBody {
  messageID?: string;
  agent?: string;
  model?: string;
  arguments?: string;
  command?: string;
  variant?: string;
  parts?: Parameters<
    ReturnType<typeof getClient>['session']['command']
  >[0] extends infer P
    ? P extends { parts?: infer R }
      ? R
      : never
    : never;
  workspace?: string;
}

export interface SessionShellBody {
  messageID?: string;
  agent?: string;
  model?: SessionModelRef;
  command?: string;
  workspace?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the 2nd `options` argument for an SDK call. Returns `undefined` when
 * no signal is present so the SDK falls back to its own defaults.
 */
function buildOptions(
  opts?: SessionApiOpts,
): { signal: AbortSignal } | undefined {
  return opts?.signal ? { signal: opts.signal } : undefined;
}

/**
 * Spread `directory` into a parameters object only if defined, so that the
 * SDK's own defaults take over when the caller omits it.
 */
function withDirectory<T extends object>(
  params: T,
  directory: string | undefined,
): T & { directory?: string } {
  return directory === undefined ? params : { ...params, directory };
}

// ---------------------------------------------------------------------------
// Wrappers
// ---------------------------------------------------------------------------

/**
 * GET /session — list all sessions.
 *
 * @param port Local OpenCode server port.
 * @param query Optional filters: `roots`, `start`, `search`, `limit`, `workspace`.
 * @param opts Optional `directory` and `signal`.
 * @returns Raw SDK response `{ data, error, response }`.
 */
export async function sessionList(
  port: number,
  query?: SessionListQuery,
  opts?: SessionApiOpts,
) {
  const client = getClient(port, opts?.directory);
  const params = withDirectory({ ...(query ?? {}) }, opts?.directory);
  return client.session.list(params, buildOptions(opts));
}

/**
 * POST /session — create a new session.
 *
 * @param port Local OpenCode server port.
 * @param body Optional body: `parentID`, `title`, `permission`, `workspaceID`, `workspace`.
 * @param opts Optional `directory` and `signal`.
 * @returns Raw SDK response `{ data, error, response }`.
 */
export async function sessionCreate(
  port: number,
  body?: SessionCreateBody,
  opts?: SessionApiOpts,
) {
  const client = getClient(port, opts?.directory);
  const params = withDirectory({ ...(body ?? {}) }, opts?.directory);
  return client.session.create(params, buildOptions(opts));
}

/**
 * GET /session/status — retrieve the current status of all sessions.
 *
 * @param port Local OpenCode server port.
 * @param opts Optional `directory` and `signal`.
 * @returns Raw SDK response `{ data, error, response }`.
 */
export async function sessionStatus(port: number, opts?: SessionApiOpts) {
  const client = getClient(port, opts?.directory);
  const params = withDirectory({}, opts?.directory);
  return client.session.status(params, buildOptions(opts));
}

/**
 * GET /session/{sessionID} — retrieve details for a specific session.
 *
 * @param port Local OpenCode server port.
 * @param sessionID Session identifier.
 * @param opts Optional `directory` and `signal`.
 * @returns Raw SDK response `{ data, error, response }`.
 */
export async function sessionGet(
  port: number,
  sessionID: string,
  opts?: SessionApiOpts,
) {
  const client = getClient(port, opts?.directory);
  const params = withDirectory({ sessionID }, opts?.directory);
  return client.session.get(params, buildOptions(opts));
}

/**
 * PATCH /session/{sessionID} — update session metadata.
 *
 * @param port Local OpenCode server port.
 * @param sessionID Session identifier.
 * @param body Optional body: `title`, `permission`, `time`, `workspace`.
 * @param opts Optional `directory` and `signal`.
 * @returns Raw SDK response `{ data, error, response }`.
 */
export async function sessionUpdate(
  port: number,
  sessionID: string,
  body?: SessionUpdateBody,
  opts?: SessionApiOpts,
) {
  const client = getClient(port, opts?.directory);
  const params = withDirectory({ sessionID, ...(body ?? {}) }, opts?.directory);
  return client.session.update(params, buildOptions(opts));
}

/**
 * DELETE /session/{sessionID} — delete a session and all its data.
 *
 * @param port Local OpenCode server port.
 * @param sessionID Session identifier.
 * @param opts Optional `directory` and `signal`.
 * @returns Raw SDK response `{ data, error, response }`.
 */
export async function sessionDelete(
  port: number,
  sessionID: string,
  opts?: SessionApiOpts,
) {
  const client = getClient(port, opts?.directory);
  const params = withDirectory({ sessionID }, opts?.directory);
  return client.session.delete(params, buildOptions(opts));
}

/**
 * GET /session/{sessionID}/children — list child sessions forked from this one.
 *
 * @param port Local OpenCode server port.
 * @param sessionID Session identifier.
 * @param opts Optional `directory` and `signal`.
 * @returns Raw SDK response `{ data, error, response }`.
 */
export async function sessionChildren(
  port: number,
  sessionID: string,
  opts?: SessionApiOpts,
) {
  const client = getClient(port, opts?.directory);
  const params = withDirectory({ sessionID }, opts?.directory);
  return client.session.children(params, buildOptions(opts));
}

/**
 * GET /session/{sessionID}/todo — list todos attached to a session.
 *
 * @param port Local OpenCode server port.
 * @param sessionID Session identifier.
 * @param opts Optional `directory` and `signal`.
 * @returns Raw SDK response `{ data, error, response }`.
 */
export async function sessionTodo(
  port: number,
  sessionID: string,
  opts?: SessionApiOpts,
) {
  const client = getClient(port, opts?.directory);
  const params = withDirectory({ sessionID }, opts?.directory);
  return client.session.todo(params, buildOptions(opts));
}

/**
 * POST /session/{sessionID}/init — initialize AGENTS.md for a session.
 *
 * @param port Local OpenCode server port.
 * @param sessionID Session identifier.
 * @param body Optional body: `modelID`, `providerID`, `messageID`, `workspace`.
 * @param opts Optional `directory` and `signal`.
 * @returns Raw SDK response `{ data, error, response }`.
 */
export async function sessionInit(
  port: number,
  sessionID: string,
  body?: SessionInitBody,
  opts?: SessionApiOpts,
) {
  const client = getClient(port, opts?.directory);
  const params = withDirectory({ sessionID, ...(body ?? {}) }, opts?.directory);
  return client.session.init(params, buildOptions(opts));
}

/**
 * POST /session/{sessionID}/fork — fork a session at a given message.
 *
 * @param port Local OpenCode server port.
 * @param sessionID Session identifier.
 * @param body Optional body: `messageID`, `workspace`.
 * @param opts Optional `directory` and `signal`.
 * @returns Raw SDK response `{ data, error, response }`.
 */
export async function sessionFork(
  port: number,
  sessionID: string,
  body?: SessionForkBody,
  opts?: SessionApiOpts,
) {
  const client = getClient(port, opts?.directory);
  const params = withDirectory({ sessionID, ...(body ?? {}) }, opts?.directory);
  return client.session.fork(params, buildOptions(opts));
}

/**
 * POST /session/{sessionID}/abort — abort an active session.
 *
 * @param port Local OpenCode server port.
 * @param sessionID Session identifier.
 * @param opts Optional `directory` and `signal`.
 * @returns Raw SDK response `{ data, error, response }`.
 */
export async function sessionAbort(
  port: number,
  sessionID: string,
  opts?: SessionApiOpts,
) {
  const client = getClient(port, opts?.directory);
  const params = withDirectory({ sessionID }, opts?.directory);
  return client.session.abort(params, buildOptions(opts));
}

/**
 * POST /session/{sessionID}/share — create a shareable link for a session.
 *
 * @param port Local OpenCode server port.
 * @param sessionID Session identifier.
 * @param opts Optional `directory` and `signal`.
 * @returns Raw SDK response `{ data, error, response }`.
 */
export async function sessionShare(
  port: number,
  sessionID: string,
  opts?: SessionApiOpts,
) {
  const client = getClient(port, opts?.directory);
  const params = withDirectory({ sessionID }, opts?.directory);
  return client.session.share(params, buildOptions(opts));
}

/**
 * DELETE /session/{sessionID}/share — remove a session share link.
 *
 * @param port Local OpenCode server port.
 * @param sessionID Session identifier.
 * @param opts Optional `directory` and `signal`.
 * @returns Raw SDK response `{ data, error, response }`.
 */
export async function sessionUnshare(
  port: number,
  sessionID: string,
  opts?: SessionApiOpts,
) {
  const client = getClient(port, opts?.directory);
  const params = withDirectory({ sessionID }, opts?.directory);
  return client.session.unshare(params, buildOptions(opts));
}

/**
 * GET /session/{sessionID}/diff — get file diff for a specific message.
 *
 * @param port Local OpenCode server port.
 * @param sessionID Session identifier.
 * @param body Optional body (encoded as query): `messageID`, `workspace`.
 * @param opts Optional `directory` and `signal`.
 * @returns Raw SDK response `{ data, error, response }`.
 */
export async function sessionDiff(
  port: number,
  sessionID: string,
  body?: SessionDiffBody,
  opts?: SessionApiOpts,
) {
  const client = getClient(port, opts?.directory);
  const params = withDirectory({ sessionID, ...(body ?? {}) }, opts?.directory);
  return client.session.diff(params, buildOptions(opts));
}

/**
 * POST /session/{sessionID}/summarize — summarize a session with AI compaction.
 *
 * @param port Local OpenCode server port.
 * @param sessionID Session identifier.
 * @param body Optional body: `providerID`, `modelID`, `auto`, `workspace`.
 * @param opts Optional `directory` and `signal`.
 * @returns Raw SDK response `{ data, error, response }`.
 */
export async function sessionSummarize(
  port: number,
  sessionID: string,
  body?: SessionSummarizeBody,
  opts?: SessionApiOpts,
) {
  const client = getClient(port, opts?.directory);
  const params = withDirectory({ sessionID, ...(body ?? {}) }, opts?.directory);
  return client.session.summarize(params, buildOptions(opts));
}

/**
 * GET /session/{sessionID}/message — list messages in a session.
 *
 * @param port Local OpenCode server port.
 * @param sessionID Session identifier.
 * @param query Optional query: `limit`, `before`, `workspace`.
 * @param opts Optional `directory` and `signal`.
 * @returns Raw SDK response `{ data, error, response }`.
 */
export async function sessionMessages(
  port: number,
  sessionID: string,
  query?: SessionMessagesQuery,
  opts?: SessionApiOpts,
) {
  const client = getClient(port, opts?.directory);
  const params = withDirectory(
    { sessionID, ...(query ?? {}) },
    opts?.directory,
  );
  return client.session.messages(params, buildOptions(opts));
}

/**
 * POST /session/{sessionID}/message — send a synchronous prompt to a session.
 *
 * @param port Local OpenCode server port.
 * @param sessionID Session identifier.
 * @param body Prompt body including `parts` and optional generation settings.
 * @param opts Optional `directory` and `signal`.
 * @returns Raw SDK response `{ data, error, response }`.
 */
export async function sessionPrompt(
  port: number,
  sessionID: string,
  body: SessionPromptBody,
  opts?: SessionApiOpts,
) {
  const client = getClient(port, opts?.directory);
  const params = withDirectory({ sessionID, ...body }, opts?.directory);
  return client.session.prompt(params, buildOptions(opts));
}

/**
 * POST /session/{sessionID}/prompt_async — send an async prompt; returns immediately.
 *
 * @param port Local OpenCode server port.
 * @param sessionID Session identifier.
 * @param body Prompt body including `parts` and optional generation settings.
 * @param opts Optional `directory` and `signal`.
 * @returns Raw SDK response `{ data, error, response }`.
 */
export async function sessionPromptAsync(
  port: number,
  sessionID: string,
  body: SessionPromptBody,
  opts?: SessionApiOpts,
) {
  const client = getClient(port, opts?.directory);
  const params = withDirectory({ sessionID, ...body }, opts?.directory);
  return client.session.promptAsync(params, buildOptions(opts));
}

/**
 * POST /session/{sessionID}/command — send a command for AI execution.
 *
 * @param port Local OpenCode server port.
 * @param sessionID Session identifier.
 * @param body Command body: `command`, `arguments`, `agent`, `model`, `messageID`, `variant`, `parts`.
 * @param opts Optional `directory` and `signal`.
 * @returns Raw SDK response `{ data, error, response }`.
 */
export async function sessionCommand(
  port: number,
  sessionID: string,
  body: SessionCommandBody,
  opts?: SessionApiOpts,
) {
  const client = getClient(port, opts?.directory);
  const params = withDirectory({ sessionID, ...body }, opts?.directory);
  return client.session.command(params, buildOptions(opts));
}

/**
 * POST /session/{sessionID}/shell — run a shell command in the session context.
 *
 * @param port Local OpenCode server port.
 * @param sessionID Session identifier.
 * @param body Shell body: `command`, `agent`, `model`, `messageID`, `workspace`.
 * @param opts Optional `directory` and `signal`.
 * @returns Raw SDK response `{ data, error, response }`.
 */
export async function sessionShell(
  port: number,
  sessionID: string,
  body: SessionShellBody,
  opts?: SessionApiOpts,
) {
  const client = getClient(port, opts?.directory);
  const params = withDirectory({ sessionID, ...body }, opts?.directory);
  return client.session.shell(params, buildOptions(opts));
}

/**
 * POST /session/{sessionID}/revert — revert a specific message's effects.
 *
 * @param port Local OpenCode server port.
 * @param sessionID Session identifier.
 * @param body Optional body: `messageID`, `partID`, `workspace`.
 * @param opts Optional `directory` and `signal`.
 * @returns Raw SDK response `{ data, error, response }`.
 */
export async function sessionRevert(
  port: number,
  sessionID: string,
  body?: SessionRevertBody,
  opts?: SessionApiOpts,
) {
  const client = getClient(port, opts?.directory);
  const params = withDirectory({ sessionID, ...(body ?? {}) }, opts?.directory);
  return client.session.revert(params, buildOptions(opts));
}

/**
 * POST /session/{sessionID}/unrevert — restore previously reverted messages.
 *
 * @param port Local OpenCode server port.
 * @param sessionID Session identifier.
 * @param opts Optional `directory` and `signal`.
 * @returns Raw SDK response `{ data, error, response }`.
 */
export async function sessionUnrevert(
  port: number,
  sessionID: string,
  opts?: SessionApiOpts,
) {
  const client = getClient(port, opts?.directory);
  const params = withDirectory({ sessionID }, opts?.directory);
  return client.session.unrevert(params, buildOptions(opts));
}

/**
 * GET /session/{sessionID}/message/{messageID} — retrieve a single message.
 *
 * @param port Local OpenCode server port.
 * @param sessionID Session identifier.
 * @param messageID Message identifier.
 * @param opts Optional `directory` and `signal`.
 * @returns Raw SDK response `{ data, error, response }`.
 */
export async function sessionMessage(
  port: number,
  sessionID: string,
  messageID: string,
  opts?: SessionApiOpts,
) {
  const client = getClient(port, opts?.directory);
  const params = withDirectory({ sessionID, messageID }, opts?.directory);
  return client.session.message(params, buildOptions(opts));
}

/**
 * DELETE /session/{sessionID}/message/{messageID} — delete a single message.
 *
 * @param port Local OpenCode server port.
 * @param sessionID Session identifier.
 * @param messageID Message identifier.
 * @param opts Optional `directory` and `signal`.
 * @returns Raw SDK response `{ data, error, response }`.
 */
export async function sessionDeleteMessage(
  port: number,
  sessionID: string,
  messageID: string,
  opts?: SessionApiOpts,
) {
  const client = getClient(port, opts?.directory);
  const params = withDirectory({ sessionID, messageID }, opts?.directory);
  return client.session.deleteMessage(params, buildOptions(opts));
}
