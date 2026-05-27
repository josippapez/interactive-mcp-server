import {
  getAllRegisteredConnections,
  getRegisteredConnectionBySessionId,
} from './database';
import { getClient } from './sdk-client';
import { createLogger } from '../../utils/logger';
import { errorMessage } from '../../utils/errors';
import { fetchAllOpenCodeSessions, fetchOpenCodeSession } from './session';

export type PendingQuestionOption = {
  label: string;
  description: string;
};

export type PendingQuestionInfo = {
  question: string;
  header: string;
  options: PendingQuestionOption[];
  multiple?: boolean;
  custom?: boolean;
};

export type PendingQuestionRecord = {
  requestId: string;
  sessionID: string;
  questions: PendingQuestionInfo[];
  tool?: { messageID: string; callID: string };
};

const questionLog = createLogger('question');
const QUESTION_REPLY_STILL_PENDING_ERROR =
  'Question reply was accepted but the request is still pending.';
const clearedQuestionRequestIds = new Set<string>();

function serializeQuestionError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isUnknownQuestionRequestError(error: unknown): boolean {
  return serializeQuestionError(error)
    .toLowerCase()
    .includes('reply for unknown request');
}

function markQuestionCleared(requestID: string): void {
  clearedQuestionRequestIds.add(requestID);
}

async function resolveSessionDirectory(
  openCodePort: number,
  sessionID: string,
): Promise<string | undefined> {
  const registered = await getRegisteredConnectionBySessionId(
    sessionID,
    'opencode',
  );
  if (registered?.baseDirectory) return registered.baseDirectory;

  const session = await fetchOpenCodeSession(openCodePort, sessionID);
  return session?.directory;
}

function mapPendingQuestion(item: {
  id?: string;
  sessionID?: string;
  questions?: PendingQuestionInfo[];
  tool?: { messageID: string; callID: string };
}): PendingQuestionRecord | null {
  if (!item.id || !item.sessionID) return null;
  return {
    requestId: item.id,
    sessionID: item.sessionID,
    questions: item.questions ?? [],
    tool: item.tool,
  };
}

async function fetchPendingQuestionsForDirectory(
  openCodePort: number,
  directory: string | undefined,
): Promise<PendingQuestionRecord[]> {
  const client = getClient(openCodePort, directory);
  const result = await client.question.list(
    directory ? { directory } : undefined,
  );
  const questions = result.data ?? [];
  return questions.flatMap((item) => {
    const mapped = mapPendingQuestion(item);
    return mapped ? [mapped] : [];
  });
}

export async function fetchPendingQuestions(
  openCodePort: number,
): Promise<PendingQuestionRecord[]> {
  try {
    const registeredDirectories = getAllRegisteredConnections()
      .filter(
        (connection) =>
          connection.providerType === 'opencode' && connection.baseDirectory,
      )
      .map((connection) => connection.baseDirectory as string);
    const liveSessions = (await fetchAllOpenCodeSessions(openCodePort)) ?? [];
    const liveDirectories = liveSessions.flatMap((session) =>
      session.directory ? [session.directory] : [],
    );
    const directories = Array.from(
      new Set(
        [...registeredDirectories, ...liveDirectories].filter(
          (directory) => directory.trim().length > 0,
        ),
      ),
    );

    const results = await Promise.allSettled([
      fetchPendingQuestionsForDirectory(openCodePort, undefined),
      ...directories.map((directory) =>
        fetchPendingQuestionsForDirectory(openCodePort, directory),
      ),
    ]);

    const byRequestId = new Map<string, PendingQuestionRecord>();
    for (const result of results) {
      if (result.status === 'rejected') {
        questionLog.error(
          `fetchPendingQuestions scoped request error: ${errorMessage(result.reason)}`,
        );
        continue;
      }
      for (const question of result.value) {
        if (clearedQuestionRequestIds.has(question.requestId)) continue;
        if (!byRequestId.has(question.requestId)) {
          byRequestId.set(question.requestId, question);
        }
      }
    }

    return [...byRequestId.values()];
  } catch (err: unknown) {
    questionLog.error(`fetchPendingQuestions error: ${errorMessage(err)}`);
    return [];
  }
}

export function _resetClearedQuestionRequestIdsForTest(): void {
  clearedQuestionRequestIds.clear();
}

export async function replyToOpenCodeQuestion(
  openCodePort: number,
  requestID: string,
  answers: string[][],
  sessionID: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const effectiveDirectory = await resolveSessionDirectory(
      openCodePort,
      sessionID,
    );
    const client = getClient(openCodePort, effectiveDirectory);

    questionLog.info(
      `reply start session=${sessionID} request=${requestID} answers=${JSON.stringify(answers)} directory=${effectiveDirectory ?? '(none)'}`,
    );

    const result = await client.question.reply({
      requestID,
      answers,
      directory: effectiveDirectory,
    });

    if (result.error) {
      const serializedError = serializeQuestionError(result.error as unknown);
      questionLog.error(
        `reply error session=${sessionID} request=${requestID} error=${serializedError}`,
      );
      if (isUnknownQuestionRequestError(result.error as unknown)) {
        markQuestionCleared(requestID);
        questionLog.info(
          `reply error says question is unknown session=${sessionID} request=${requestID}; suppressing stale pending item`,
        );
        return { ok: true };
      }
      // Even though the reply returned an error, the question may have already
      // been consumed by OpenCode (for example, "reply for unknown request"
      // means it
      // timed out or was cleared server-side). Check whether the question is
      // still pending and treat its absence as a success. This prevents the
      // caller from showing a stuck question that the user retries indefinitely.
      const listAfterError = await client.question.list({
        directory: effectiveDirectory,
      });
      const isStillPendingAfterError = (listAfterError.data ?? []).some(
        (item) => item?.id === requestID,
      );
      if (!isStillPendingAfterError) {
        markQuestionCleared(requestID);
        questionLog.info(
          `reply error but question already cleared session=${sessionID} request=${requestID}; treating as success`,
        );
        return { ok: true };
      }
      return { ok: false, error: serializedError };
    }

    const listResult = await client.question.list({
      directory: effectiveDirectory,
    });
    const stillPending = (listResult.data ?? []).some(
      (item) => item?.id === requestID,
    );
    if (!stillPending) {
      markQuestionCleared(requestID);
      questionLog.info(
        `reply success session=${sessionID} request=${requestID}`,
      );
      return { ok: true };
    }

    questionLog.warn(
      `reply not delivered session=${sessionID} request=${requestID} directory=${effectiveDirectory ?? '(none)'} — retrying unscoped`,
    );

    const unscopedClient = getClient(openCodePort);
    const retry = await unscopedClient.question.reply({
      requestID,
      answers,
    });
    if (retry.error) {
      const serializedError = serializeQuestionError(retry.error as unknown);
      questionLog.error(
        `reply retry error session=${sessionID} request=${requestID} error=${serializedError}`,
      );
      if (isUnknownQuestionRequestError(retry.error as unknown)) {
        markQuestionCleared(requestID);
        questionLog.info(
          `reply retry error says question is unknown session=${sessionID} request=${requestID}; suppressing stale pending item`,
        );
        return { ok: true };
      }
      return { ok: false, error: serializedError };
    }

    const listAfterRetry = await unscopedClient.question.list();
    const stillPendingAfterRetry = (listAfterRetry.data ?? []).some(
      (item) => item?.id === requestID,
    );
    if (stillPendingAfterRetry) {
      questionLog.error(
        `reply retry not delivered session=${sessionID} request=${requestID} — request still present after retry`,
      );
      return { ok: false, error: QUESTION_REPLY_STILL_PENDING_ERROR };
    }

    markQuestionCleared(requestID);
    questionLog.info(`reply success session=${sessionID} request=${requestID}`);
    return { ok: true };
  } catch (err: unknown) {
    const message = errorMessage(err);
    questionLog.error(
      `reply exception session=${sessionID} request=${requestID} error=${message}`,
    );
    return { ok: false, error: message };
  }
}

export async function rejectOpenCodeQuestion(
  openCodePort: number,
  requestID: string,
  sessionID: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const effectiveDirectory = await resolveSessionDirectory(
      openCodePort,
      sessionID,
    );
    const client = getClient(openCodePort, effectiveDirectory);

    questionLog.info(
      `reject start session=${sessionID} request=${requestID} directory=${effectiveDirectory ?? '(none)'}`,
    );

    const result = await client.question.reject({
      requestID,
      directory: effectiveDirectory,
    });

    if (result.error) {
      questionLog.error(
        `reject error session=${sessionID} request=${requestID} error=${String(result.error)}`,
      );
      return { ok: false, error: String(result.error) };
    }

    questionLog.info(
      `reject success session=${sessionID} request=${requestID}`,
    );
    return { ok: true };
  } catch (err: unknown) {
    const message = errorMessage(err);
    questionLog.error(
      `reject exception session=${sessionID} request=${requestID} error=${message}`,
    );
    return { ok: false, error: message };
  }
}

export async function rejectPendingQuestionsForSession(
  openCodePort: number,
  sessionID: string,
): Promise<string[]> {
  const pendingQuestions = await fetchPendingQuestions(openCodePort);
  const requestIds = pendingQuestions
    .filter((question) => question.sessionID === sessionID)
    .map((question) => question.requestId);

  const settled = await Promise.allSettled(
    requestIds.map((requestId) =>
      rejectOpenCodeQuestion(openCodePort, requestId, sessionID),
    ),
  );

  const rejectedRequestIds: string[] = [];
  settled.forEach((result, index) => {
    const requestId = requestIds[index];
    if (result.status === 'fulfilled' && result.value.ok) {
      rejectedRequestIds.push(requestId);
      return;
    }

    const reason =
      result.status === 'rejected'
        ? errorMessage(result.reason)
        : (result.value.error ?? 'unknown error');
    questionLog.warn(
      `abort reject failed session=${sessionID} request=${requestId} error=${reason}`,
    );
  });

  return rejectedRequestIds;
}
