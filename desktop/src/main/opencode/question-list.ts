import { getRegisteredConnectionBySessionId } from '../database';
import {
  createOpencodeClient,
  type OpencodeClient,
} from '@opencode-ai/sdk/v2/client';
import { createLogger } from '../utils/logger';

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

let _questionClientFactory: (
  openCodePort: number,
  directory?: string,
) => OpencodeClient = (openCodePort: number, directory?: string) =>
  createOpencodeClient({
    baseUrl: `http://localhost:${openCodePort}`,
    directory,
  });

export function _setQuestionClientFactory(
  factory: (openCodePort: number, directory?: string) => OpencodeClient,
): void {
  _questionClientFactory = factory;
}

export function _resetQuestionClientFactory(): void {
  _questionClientFactory = (openCodePort: number, directory?: string) =>
    createOpencodeClient({
      baseUrl: `http://localhost:${openCodePort}`,
      directory,
    });
}

// TODO: fetchPendingQuestions is port-only and relies on opencode's
// WorkspaceRouterMiddleware falling back to process.cwd() — it may miss pending
// questions on non-cwd Instances. Consider fanning out over all registered
// baseDirectories for full coverage.
export async function fetchPendingQuestions(
  openCodePort: number,
): Promise<PendingQuestionRecord[]> {
  try {
    const client = _questionClientFactory(openCodePort);
    const result = await client.question.list();
    const questions = result.data ?? [];

    return questions
      .filter((item) => item?.id && item?.sessionID)
      .map((item) => ({
        requestId: item.id,
        sessionID: item.sessionID,
        questions: item.questions ?? [],
        tool: item.tool,
      }));
  } catch (err: unknown) {
    questionLog.error(
      `fetchPendingQuestions error: ${err instanceof Error ? err.message : String(err)}`,
    );
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
    const registered = getRegisteredConnectionBySessionId(
      sessionID,
      'opencode',
    );
    const effectiveDirectory = registered?.baseDirectory ?? undefined;
    const client = _questionClientFactory(openCodePort, effectiveDirectory);

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

    // Verify delivery: if the requestID is still pending after reply, the
    // WorkspaceRouterMiddleware likely routed to the wrong Instance.
    try {
      const listResult = await client.question.list({
        directory: effectiveDirectory,
      });
      const stillPending = (listResult.data ?? []).some(
        (item) => item?.id === requestID,
      );
      if (stillPending) {
        questionLog.error(
          `reply not delivered session=${sessionID} request=${requestID} directory=${effectiveDirectory ?? '(none)'} — request still present after reply`,
        );
        return { ok: false, error: 'reply not delivered' };
      }
    } catch (listErr: unknown) {
      questionLog.warn(
        `reply verification list failed session=${sessionID} request=${requestID} error=${listErr instanceof Error ? listErr.message : String(listErr)}`,
      );
    }

    questionLog.info(`reply success session=${sessionID} request=${requestID}`);
    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
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
    const registered = getRegisteredConnectionBySessionId(
      sessionID,
      'opencode',
    );
    const effectiveDirectory = registered?.baseDirectory ?? undefined;
    const client = _questionClientFactory(openCodePort, effectiveDirectory);

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
    const message = err instanceof Error ? err.message : String(err);
    questionLog.error(
      `reject exception session=${sessionID} request=${requestID} error=${message}`,
    );
    return { ok: false, error: message };
  }
}
