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
      questionLog.error(
        `reply error session=${sessionID} request=${requestID} error=${String(result.error)}`,
      );
      return { ok: false, error: String(result.error) };
    }

    const listResult = await client.question.list({
      directory: effectiveDirectory,
    });
    const stillPending = (listResult.data ?? []).some(
      (item) => item?.id === requestID,
    );
    if (!stillPending) {
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
      questionLog.error(
        `reply retry error session=${sessionID} request=${requestID} error=${String(retry.error)}`,
      );
      return { ok: false, error: String(retry.error) };
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
