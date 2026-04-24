/**
 * Pure handler logic for the `inject-doc-context` IPC command.
 *
 * Extracted from ipc-handlers.ts so it can be unit-tested without mocking
 * Electron's ipcMain / BrowserWindow infrastructure.
 */

import { searchDocs, formatSearchResults } from './context-injector';
import { injectOpenCodeMessage } from '../utility/opencode-client';
import {
  getRegisteredConnection,
  getRegisteredConnectionBySessionId,
  upsertContextInjection,
} from '../utility/db-client';
import { errorMessage } from '../utils/errors';

export interface InjectDocContextInput {
  connectionId: string;
  /** Null in standalone mode (no OpenCode) — triggers SQLite queue injection instead. */
  openCodeSessionId: string | null;
  message: string;
  baseDirectory?: string | null;
  /**
   * When true, the <system-reminder> wrapper is omitted so the raw doc context
   * is visible as plain text in the OpenCode session log. Default: false.
   */
  debug?: boolean;
}

export interface InjectDocContextResult {
  ok: boolean;
  injectedCount: number;
  error?: string;
}

export interface InjectDocContextDeps {
  openCodePort: number;
  getRegisteredConnection: typeof getRegisteredConnection;
  /**
   * Optional session-based lookup. When provided and `openCodeSessionId` is
   * available, this is used to reliably detect subagent sessions even when the
   * `connectionId`-based lookup returns the parent row (shared MCP client).
   */
  getRegisteredConnectionBySessionId?: typeof getRegisteredConnectionBySessionId;
  searchDocs: typeof searchDocs;
  injectOpenCodeMessage: typeof injectOpenCodeMessage;
  upsertContextInjection: typeof upsertContextInjection;
  sendAgentMessage: (providerSessionId: string | null, message: string) => void;
}

/**
 * Search for relevant docs matching `message` and inject a concise summary as
 * noReply context into the OpenCode session, then surface it live in the UI
 * channel history (not persisted to DB — Option A).
 */
export async function handleInjectDocContext(
  input: InjectDocContextInput,
  deps: InjectDocContextDeps,
): Promise<InjectDocContextResult> {
  const { connectionId, openCodeSessionId, message, debug = false } = input;

  // Resolve baseDirectory and check for parent session: use supplied value or look up from DB
  let baseDirectory: string | null = input.baseDirectory ?? null;
  const conn = await deps.getRegisteredConnection(connectionId);
  if (!baseDirectory) {
    baseDirectory = conn?.baseDirectory ?? null;
  }

  if (!baseDirectory) {
    // No repo directory — nothing to inject
    return { ok: true, injectedCount: 0 };
  }

  // Skip doc context injection for subagent/child sessions (parentSessionId set).
  // Injecting a <system-reminder> into a child OpenCode session causes it to
  // propagate up to the parent session via OpenCode's session hierarchy, leaking
  // the reminder into the parent agent's context.
  //
  // When openCodeSessionId is available and the session-based lookup dep is
  // provided, prefer it over the connectionId-based lookup. In shared-MCP-client
  // scenarios (OpenCode), multiple sessions share the same connectionId, so
  // getRegisteredConnection(connectionId) may return the parent row even when
  // the tool call originated from a subagent. The session-based lookup resolves
  // the correct row for the calling session.
  const sessionConn =
    openCodeSessionId && deps.getRegisteredConnectionBySessionId
      ? await deps.getRegisteredConnectionBySessionId(openCodeSessionId)
      : null;
  const effectiveConn = sessionConn ?? conn;

  if (effectiveConn?.parentSessionId) {
    return { ok: true, injectedCount: 0 };
  }

  let results: Awaited<ReturnType<typeof searchDocs>>;
  try {
    results = await deps.searchDocs(message, baseDirectory, 5);
  } catch (err) {
    const msg = errorMessage(err);
    return { ok: false, injectedCount: 0, error: `searchDocs failed: ${msg}` };
  }

  if (results.length === 0) {
    return { ok: true, injectedCount: 0 };
  }

  // Build a concise context snippet
  const innerText = [
    `Relevant repository documentation for this message:`,
    '',
    formatSearchResults(results, message),
    '',
    'Use the Read tool or find_repo_docs tool to access full content of any listed file.',
  ].join('\n');

  const summaryText = debug
    ? innerText
    : `<system-reminder>\n${innerText}\n</system-reminder>`;

  if (!openCodeSessionId) {
    // Standalone mode (no OpenCode) — queue into SQLite for poll_context_injections delivery.
    // Resolve the provider session id from the connection row so the injection is keyed
    // consistently with the rest of the unified DB schema.
    const standaloneProviderSessionId = effectiveConn?.providerSessionId;
    if (!standaloneProviderSessionId) {
      return {
        ok: false,
        injectedCount: 0,
        error: `No provider session found for connectionId=${connectionId}`,
      };
    }
    await deps.upsertContextInjection(
      standaloneProviderSessionId,
      'standalone',
      summaryText,
      'doc-context',
      'doc-context',
    );

    // Surface a visible summary in the UI channel (live only — not persisted to DB)
    const visibleSummary = [
      `**Context queued for agent (${results.length} docs):**`,
      ...results.map((r, i) => `${i + 1}. \`${r.path}\``),
    ].join('\n');
    deps.sendAgentMessage(standaloneProviderSessionId, visibleSummary);

    return { ok: true, injectedCount: results.length };
  }

  // Inject into OpenCode as noReply context
  const injectResult = await deps.injectOpenCodeMessage(
    openCodeSessionId,
    summaryText,
    undefined,
    deps.openCodePort,
  );

  if (!injectResult.ok) {
    return {
      ok: false,
      injectedCount: 0,
      error: `doc context inject failed: ${injectResult.error}`,
    };
  }

  // Build a human-readable summary to surface in the UI channel (live only — not persisted to DB)
  const visibleSummary = [
    `**Context injected (${results.length} docs):**`,
    ...results.map((r, i) => `${i + 1}. \`${r.path}\``),
  ].join('\n');

  // Emit to renderer so it shows up in chat immediately (not persisted to DB per Option A)
  deps.sendAgentMessage(openCodeSessionId, visibleSummary);

  return { ok: true, injectedCount: results.length };
}
