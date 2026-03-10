import * as OpenTuiCore from '@opentui/core';
import * as OpenTuiReact from '@opentui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { InteractiveInput } from '@/components/InteractiveInput.js';
import { MarkdownText } from '@/components/MarkdownText.js';
import { PromptStatus } from '@/components/PromptStatus.js';
import {
  USER_INPUT_TIMEOUT_SECONDS,
  USER_INPUT_TIMEOUT_SENTINEL,
} from '@/constants.js';
import logger from '../../utils/logger.js';
import { resolveSearchRoot } from '../../utils/search-root.js';

interface ChatMessage {
  text: string;
  isQuestion: boolean;
  answer?: string;
}

interface CliRendererLike {
  destroy: () => void;
}

interface CliRootLike {
  render: (node: unknown) => void;
  unmount?: () => void;
}

interface ScrollBoxLike {
  scrollTo?: (position: number | { x: number; y: number }) => void;
}

const { createCliRenderer } = OpenTuiCore as unknown as {
  createCliRenderer: (config?: {
    exitOnCtrlC?: boolean;
  }) => Promise<CliRendererLike>;
};

const { createRoot } = OpenTuiReact as unknown as {
  createRoot: (renderer: CliRendererLike) => CliRootLike;
};
const { useTerminalDimensions } = OpenTuiReact as unknown as {
  useTerminalDimensions: () => { width: number; height: number };
};

const decodeSearchRootArg = (
  encodedSearchRoot?: string,
): string | undefined => {
  if (!encodedSearchRoot) {
    return undefined;
  }

  try {
    return Buffer.from(encodedSearchRoot, 'base64').toString('utf8');
  } catch {
    return undefined;
  }
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const searchRootFromArg = decodeSearchRootArg(args[1]);
  const defaults = {
    sessionId: crypto.randomUUID(),
    title: 'Interactive Chat Session',
    outputDir: undefined as string | undefined,
    searchRoot: searchRootFromArg,
    timeoutSeconds: USER_INPUT_TIMEOUT_SECONDS,
  };

  if (args[0]) {
    try {
      const decoded = Buffer.from(args[0], 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);
      return {
        ...defaults,
        ...parsed,
        searchRoot: parsed.searchRoot ?? searchRootFromArg,
      };
    } catch (e) {
      logger.error(
        { error: e },
        'Invalid input options payload, using defaults.',
      );
    }
  }

  return defaults;
};

const options = parseArgs();

const writeResponseToFile = async (questionId: string, response: string) => {
  if (!options.outputDir) return;

  const responseFilePath = path.join(
    options.outputDir,
    `response-${questionId}.txt`,
  );
  await fs.writeFile(responseFilePath, response, 'utf8');
  await new Promise((resolve) => setTimeout(resolve, 500));
};

const updateHeartbeat = async () => {
  if (!options.outputDir) return;

  const heartbeatPath = path.join(options.outputDir, 'heartbeat.txt');
  try {
    const dir = path.dirname(heartbeatPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(heartbeatPath, Date.now().toString(), 'utf8');
  } catch (writeError) {
    logger.error(
      { heartbeatPath, error: writeError },
      `Failed to write heartbeat file ${heartbeatPath}`,
    );
  }
};

const handleExit = () => {
  if (options.outputDir) {
    fs.writeFile(path.join(options.outputDir, 'session-closed.txt'), '', 'utf8')
      .then(() => process.exit(0))
      .catch((error) => {
        logger.error({ error }, 'Failed to write exit file');
        process.exit(1);
      });
  } else {
    process.exit(0);
  }
};

process.on('SIGINT', handleExit);
process.on('SIGTERM', handleExit);
process.on('beforeExit', handleExit);

interface AppProps {
  sessionId: string;
  title: string;
  outputDir?: string;
  searchRoot?: string;
  timeoutSeconds: number;
  onCloseSession: () => void;
}

const App = ({
  sessionId,
  title,
  outputDir,
  searchRoot,
  timeoutSeconds,
  onCloseSession,
}: AppProps) => {
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [currentQuestionId, setCurrentQuestionId] = useState<string | null>(
    null,
  );
  const [currentPredefinedOptions, setCurrentPredefinedOptions] = useState<
    string[] | undefined
  >(undefined);
  const [sessionSearchRoot, setSessionSearchRoot] = useState<
    string | undefined
  >(undefined);
  const [currentSearchRoot, setCurrentSearchRoot] = useState<
    string | undefined
  >(undefined);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [followInput, setFollowInput] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const scrollRef = useRef<ScrollBoxLike | null>(null);
  const { width, height } = useTerminalDimensions();
  const isNarrow = width < 90;

  const keepInputVisible = useCallback(() => {
    setFollowInput(true);
    scrollRef.current?.scrollTo?.({ x: 0, y: Number.MAX_SAFE_INTEGER });
  }, []);

  useEffect(() => {
    let mounted = true;

    void resolveSearchRoot(searchRoot, { argvEntry: process.argv[1] }).then(
      (resolvedSearchRoot) => {
        if (!mounted) {
          return;
        }

        setSessionSearchRoot(resolvedSearchRoot);
        setCurrentSearchRoot((prev) => prev ?? resolvedSearchRoot);
      },
    );

    return () => {
      mounted = false;
    };
  }, [searchRoot]);

  useEffect(() => {
    if (!currentQuestionId) {
      return;
    }

    setFollowInput(false);
    scrollRef.current?.scrollTo?.({ x: 0, y: 0 });
  }, [currentQuestionId]);

  useEffect(() => {
    scrollRef.current?.scrollTo?.({
      x: 0,
      y: followInput ? Number.MAX_SAFE_INTEGER : 0,
    });
  }, [followInput, height, width]);

  useEffect(() => {
    const questionPoller = setInterval(async () => {
      if (!outputDir) return;

      try {
        await updateHeartbeat();

        const inputFilePath = path.join(outputDir, `${sessionId}.json`);

        try {
          const inputExists = await fs.stat(inputFilePath);

          if (inputExists) {
            const inputFileContent = await fs.readFile(inputFilePath, 'utf8');
            let questionId: string | null = null;
            let questionText: string | null = null;
            let incomingOptions: string[] | undefined;
            let incomingSearchRoot: string | undefined;

            try {
              const inputData = JSON.parse(inputFileContent);
              if (
                typeof inputData === 'object' &&
                inputData !== null &&
                typeof inputData.id === 'string' &&
                typeof inputData.text === 'string' &&
                (inputData.options === undefined ||
                  Array.isArray(inputData.options)) &&
                (inputData.searchRoot === undefined ||
                  typeof inputData.searchRoot === 'string')
              ) {
                questionId = inputData.id;
                questionText = inputData.text;
                incomingOptions = Array.isArray(inputData.options)
                  ? inputData.options.map(String)
                  : undefined;
                incomingSearchRoot = inputData.searchRoot;
              } else {
                logger.error(
                  `Invalid format in ${sessionId}.json. Expected JSON with id (string), text (string), and optional options (array), and optional searchRoot (string).`,
                );
              }
            } catch (parseError) {
              logger.error(
                { file: `${sessionId}.json`, error: parseError },
                `Error parsing ${sessionId}.json as JSON`,
              );
            }

            if (questionId && questionText) {
              await addNewQuestion(
                questionId,
                questionText,
                incomingOptions,
                incomingSearchRoot,
              );
              await fs.unlink(inputFilePath);
            } else {
              logger.error(`Deleting invalid input file: ${inputFilePath}`);
              await fs.unlink(inputFilePath);
            }
          }
        } catch (e: unknown) {
          if (
            typeof e === 'object' &&
            e !== null &&
            'code' in e &&
            (e as { code: unknown }).code !== 'ENOENT'
          ) {
            logger.error(
              { inputFilePath, error: e },
              `Error checking/reading input file ${inputFilePath}`,
            );
          }
        }

        const closeFilePath = path.join(outputDir, 'close-session.txt');
        try {
          await fs.stat(closeFilePath);
          onCloseSession();
        } catch {
          // No close request.
        }
      } catch (error) {
        logger.error({ error }, 'Error in poll cycle');
      }
    }, 100);

    return () => clearInterval(questionPoller);
  }, [onCloseSession, outputDir, sessionId]);

  useEffect(() => {
    if (timeLeft === null || !currentQuestionId) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    if (timeLeft <= 0) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      void handleSubmit(currentQuestionId, USER_INPUT_TIMEOUT_SENTINEL);
      return;
    }

    if (!timerRef.current) {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => (prev !== null ? prev - 1 : null));
      }, 1000);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [timeLeft, currentQuestionId]);

  const addNewQuestion = async (
    questionId: string,
    questionText: string,
    incomingOptions?: string[],
    incomingSearchRoot?: string,
  ) => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    setChatHistory((prev) => [
      ...prev,
      {
        text: questionText,
        isQuestion: true,
      },
    ]);

    setCurrentQuestionId(questionId);
    setCurrentPredefinedOptions(incomingOptions);
    const resolvedSearchRoot = await resolveSearchRoot(
      incomingSearchRoot ?? sessionSearchRoot ?? searchRoot,
      { argvEntry: process.argv[1] },
    );
    setCurrentSearchRoot(resolvedSearchRoot);
    setTimeLeft(timeoutSeconds);
  };

  const handleSubmit = async (questionId: string, value: string) => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    setTimeLeft(null);

    setChatHistory((prev) =>
      prev.map((msg) => {
        if (
          msg.isQuestion &&
          !msg.answer &&
          msg ===
            prev
              .slice()
              .reverse()
              .find((m: ChatMessage) => m.isQuestion && !m.answer)
        ) {
          return { ...msg, answer: value };
        }
        return msg;
      }),
    );

    setCurrentQuestionId(null);
    setCurrentPredefinedOptions(undefined);
    setCurrentSearchRoot(sessionSearchRoot);

    if (outputDir) {
      await writeResponseToFile(questionId, value);
    }
  };

  const percentage =
    timeLeft !== null && timeoutSeconds > 0
      ? (timeLeft / timeoutSeconds) * 100
      : 0;

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor="black"
      paddingLeft={isNarrow ? 0 : 1}
      paddingRight={isNarrow ? 0 : 1}
    >
      <box
        marginBottom={1}
        flexDirection="column"
        width="100%"
        paddingLeft={1}
        paddingRight={1}
        gap={0}
      >
        <text fg="magenta">
          <strong>{title}</strong>
        </text>
        <text fg="gray" wrapMode="word">
          Session {sessionId}
        </text>
        {!isNarrow && <text fg="gray">Waiting for prompts…</text>}
      </box>

      <scrollbox
        ref={scrollRef}
        flexGrow={1}
        width="100%"
        scrollY
        stickyScroll={followInput}
        stickyStart={followInput ? 'bottom' : undefined}
        viewportCulling={false}
        scrollbarOptions={{
          showArrows: false,
        }}
      >
        <box flexDirection="column" width="100%" paddingBottom={1}>
          <box flexDirection="column" width="100%" gap={2}>
            {chatHistory.map((msg, i) => (
              <box
                key={`msg-${i}`}
                flexDirection="column"
                width="100%"
                paddingLeft={1}
                paddingRight={1}
                gap={1}
              >
                {msg.isQuestion ? (
                  <box flexDirection="column" width="100%" gap={0}>
                    <text fg="cyan">
                      <strong>QUESTION</strong>
                    </text>
                    <box paddingLeft={isNarrow ? 1 : 2}>
                      <MarkdownText
                        content={msg.text}
                        showContentCopyControl
                        contentCopyLabel="Copy question"
                        showCodeCopyControls
                      />
                    </box>
                  </box>
                ) : null}
                {msg.answer ? (
                  <box flexDirection="column" width="100%" marginTop={0}>
                    <text fg="green">
                      <strong>ANSWER</strong>
                    </text>
                    <box paddingLeft={isNarrow ? 1 : 2}>
                      <MarkdownText
                        content={msg.answer}
                        showContentCopyControl
                        contentCopyLabel="Copy answer"
                        showCodeCopyControls
                      />
                    </box>
                  </box>
                ) : null}
              </box>
            ))}
          </box>

          {currentQuestionId && (
            <box
              flexDirection="column"
              marginTop={1}
              paddingLeft={1}
              paddingRight={1}
              gap={1}
            >
              <InteractiveInput
                question={
                  chatHistory
                    .slice()
                    .reverse()
                    .find((m: ChatMessage) => m.isQuestion && !m.answer)
                    ?.text || ''
                }
                questionId={currentQuestionId}
                predefinedOptions={currentPredefinedOptions}
                searchRoot={currentSearchRoot}
                onSubmit={handleSubmit}
                onInputActivity={keepInputVisible}
              />
            </box>
          )}
        </box>
      </scrollbox>

      {currentQuestionId && timeLeft !== null && (
        <box paddingLeft={1} paddingRight={1} paddingTop={1}>
          <PromptStatus
            value={percentage}
            timeLeftSeconds={timeLeft}
            critical={timeLeft <= 10}
          />
        </box>
      )}
    </box>
  );
};

async function startUi() {
  // Clear before the renderer takes over so @opentui starts with a clean slate
  // and its diff engine is in sync with what's on screen.
  console.clear();
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
  });
  const root = createRoot(renderer);

  root.render(<App {...options} onCloseSession={handleExit} />);
}

void startUi().catch((error) => {
  logger.error({ error }, 'Failed to start intensive chat UI');
  process.exit(1);
});
