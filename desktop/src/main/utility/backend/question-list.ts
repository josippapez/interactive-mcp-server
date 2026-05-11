import {
  getAllRegisteredConnections,
  getRegisteredConnectionBySessionId,
} from './database';
import { getClient } from './sdk-client';
import { createLogger } from '../../utils/logger';
import { errorMessage } from '../../utils/errors';

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
    const directories = Array.from(
      new Set(
        getAllRegisteredConnections()
          .filter(
            (connection) =>
              connection.providerType === 'opencode' &&
              connection.baseDirectory,
          )
          .map((connection) => connection.baseDirectory as string),
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
    const registered = await getRegisteredConnectionBySessionId(
      sessionID,
      'opencode',
    );
    const effectiveDirectory = registered?.baseDirectory ?? undefined;
    const client = getClient(openCodePort, effectiveDirectory);

    questionLog.info(
      `reply start session=${sessionID} request=${requestID} answers=${JSON.stringify(answers)} directory=${effectiveDirectory ?? '(none)'} baseDirectory=${registered?.baseDirectory ?? '(none)'}`,
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

    // Verify delivery asynchronously (fire-and-forget). If the requestID is
    // still pending after reply, the WorkspaceRouterMiddleware likely routed
    // to the wrong Instance — retry the reply once in the background without
    // a directory filter (unscoped) and log if the retry also fails. This
    // keeps the UI snappy while still recovering from the router race that
    // originally motivated the verification step.
    void (async () => {
      try {
        const listResult = await client.question.list({
          directory: effectiveDirectory,
        });
        const stillPending = (listResult.data ?? []).some(
          (item) => item?.id === requestID,
        );
        if (!stillPending) return;

        questionLog.warn(
          `reply not delivered session=${sessionID} request=${requestID} directory=${effectiveDirectory ?? '(none)'} — retrying unscoped`,
        );

        // Retry unscoped so the router picks the correct Instance.
        const unscopedClient = getClient(openCodePort);
        const retry = await unscopedClient.question.reply({
          requestID,
          answers,
        });
        if (retry.error) {
          questionLog.error(
            `reply retry error session=${sessionID} request=${requestID} error=${String(retry.error)}`,
          );
          return;
        }

        const listAfterRetry = await unscopedClient.question.list();
        const stillPendingAfterRetry = (listAfterRetry.data ?? []).some(
          (item) => item?.id === requestID,
        );
        if (stillPendingAfterRetry) {
          questionLog.error(
            `reply retry not delivered session=${sessionID} request=${requestID} — request still present after retry`,
          );
        } else {
          questionLog.info(
            `reply retry success session=${sessionID} request=${requestID}`,
          );
        }
      } catch (listErr: unknown) {
        questionLog.warn(
          `reply verification/retry failed session=${sessionID} request=${requestID} error=${listErr instanceof Error ? listErr.message : String(listErr)}`,
        );
      }
    })();

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
    const registered = await getRegisteredConnectionBySessionId(
      sessionID,
      'opencode',
    );
    const effectiveDirectory = registered?.baseDirectory ?? undefined;
    const client = getClient(openCodePort, effectiveDirectory);

    questionLog.info(
      `reject start session=${sessionID} request=${requestID} directory=${effectiveDirectory ?? '(none)'} baseDirectory=${registered?.baseDirectory ?? '(none)'}`,
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
