import * as OpenTuiCore from '@opentui/core';
import * as OpenTuiReact from '@opentui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import logger from '../../utils/logger.js';
import { InteractiveInput } from '../../components/InteractiveInput.js';
import { PromptStatus } from '../../components/PromptStatus.js';
import { USER_INPUT_TIMEOUT_SENTINEL } from '@/constants.js';
import { resolveSearchRoot } from '../../utils/search-root.js';

interface CmdOptions {
  projectName?: string;
  prompt: string;
  timeout: number;
  showCountdown: boolean;
  searchRoot?: string;
  sessionId: string;
  outputFile: string;
  heartbeatFile: string;
  predefinedOptions?: string[];
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
const defaultOptions = {
  prompt: 'Enter your response:',
  timeout: 30,
  showCountdown: false,
  projectName: undefined,
  searchRoot: undefined,
  predefinedOptions: undefined,
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

const readOptionsFromFile = async (): Promise<CmdOptions> => {
  const args = process.argv.slice(2);
  const sessionId = args[0];
  const searchRootFromArg = decodeSearchRootArg(args[2]);

  if (!sessionId) {
    logger.error('No sessionId provided. Exiting.');
    throw new Error('No sessionId provided');
  }

  let tempDir = args[1];
  if (!tempDir) {
    tempDir = os.tmpdir();
  }

  const optionsFilePath = path.join(
    tempDir,
    `cmd-ui-options-${sessionId}.json`,
  );

  try {
    const optionsData = await fs.readFile(optionsFilePath, 'utf8');
    const parsedOptions = JSON.parse(optionsData) as Partial<CmdOptions>;

    if (
      !parsedOptions.sessionId ||
      !parsedOptions.outputFile ||
      !parsedOptions.heartbeatFile
    ) {
      throw new Error('Required options missing in options file.');
    }

    return {
      ...defaultOptions,
      ...parsedOptions,
      searchRoot: parsedOptions.searchRoot ?? searchRootFromArg,
      sessionId: parsedOptions.sessionId,
      outputFile: parsedOptions.outputFile,
      heartbeatFile: parsedOptions.heartbeatFile,
    } as CmdOptions;
  } catch (error) {
    logger.error(
      {
        optionsFilePath,
        error: error instanceof Error ? error.message : String(error),
      },
      `Failed to read or parse options file ${optionsFilePath}`,
    );
    throw error;
  }
};

const writeResponseToFile = async (outputFile: string, response: string) => {
  if (!outputFile) return;
  await fs.writeFile(outputFile, response, 'utf8');
};

let options: CmdOptions | null = null;
let exitHandlerAttached = false;

async function initialize() {
  try {
    options = await readOptionsFromFile();
    options.searchRoot = await resolveSearchRoot(options.searchRoot, {
      argvEntry: process.argv[1],
    });

    if (!exitHandlerAttached) {
      const handleExit = () => {
        if (options && options.outputFile) {
          writeResponseToFile(options.outputFile, '')
            .catch((error) => {
              logger.error({ error }, 'Failed to write exit file');
            })
            .finally(() => process.exit(0));
        } else {
          process.exit(0);
        }
      };

      process.on('SIGINT', handleExit);
      process.on('SIGTERM', handleExit);
      process.on('beforeExit', handleExit);
      exitHandlerAttached = true;
    }
  } catch (error) {
    logger.error({ error }, 'Initialization failed');
    process.exit(1);
  }
}

interface AppProps {
  options: CmdOptions;
  onExit: () => void;
}

const App = ({ options: appOptions, onExit }: AppProps) => {
  const {
    projectName,
    prompt,
    timeout,
    showCountdown,
    outputFile,
    heartbeatFile,
    predefinedOptions,
    searchRoot,
  } = appOptions;

  const [timeLeft, setTimeLeft] = useState(timeout);
  const [followInput, setFollowInput] = useState(false);
  const hasCompletedRef = useRef(false);
  const scrollRef = useRef<ScrollBoxLike | null>(null);
  const { width, height } = useTerminalDimensions();
  const isNarrow = width < 90;

  const keepInputVisible = useCallback(() => {
    setFollowInput(true);
    scrollRef.current?.scrollTo?.({ x: 0, y: Number.MAX_SAFE_INTEGER });
  }, []);

  const finishPrompt = useCallback(
    (response: string) => {
      if (hasCompletedRef.current) {
        return;
      }

      hasCompletedRef.current = true;
      writeResponseToFile(outputFile, response)
        .catch((err) => {
          logger.error('Failed to write response file:', err);
        })
        .finally(() => {
          onExit();
        });
    },
    [onExit, outputFile],
  );

  useEffect(() => {
    console.clear();
  }, []);

  useEffect(() => {
    setFollowInput(false);
    scrollRef.current?.scrollTo?.({ x: 0, y: 0 });
  }, [prompt]);

  useEffect(() => {
    scrollRef.current?.scrollTo?.({
      x: 0,
      y: followInput ? Number.MAX_SAFE_INTEGER : 0,
    });
  }, [followInput, height, width]);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          finishPrompt(USER_INPUT_TIMEOUT_SENTINEL);
          return 0;
        }

        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [finishPrompt]);

  useEffect(() => {
    if (!heartbeatFile) {
      return;
    }

    const heartbeatInterval = setInterval(() => {
      void (async () => {
        try {
          const now = new Date();
          await fs.utimes(heartbeatFile, now, now);
        } catch (err: unknown) {
          if (
            err &&
            typeof err === 'object' &&
            'code' in err &&
            (err as { code: string }).code === 'ENOENT'
          ) {
            try {
              await fs.writeFile(heartbeatFile, '', 'utf8');
            } catch {
              // Ignore heartbeat create failures (permissions/path issues).
            }
          }
        }
      })();
    }, 1000);

    return () => {
      clearInterval(heartbeatInterval);
    };
  }, [heartbeatFile]);

  const handleSubmit = (value: string) => {
    logger.debug(`User submitted: ${value}`);
    finishPrompt(value);
  };

  const handleInputSubmit = (_questionId: string, value: string) => {
    handleSubmit(value);
  };

  const progressValue = timeout > 0 ? (timeLeft / timeout) * 100 : 0;

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor="black"
      paddingLeft={isNarrow ? 0 : 1}
      paddingRight={isNarrow ? 0 : 1}
    >
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
        <box flexDirection="column" width="100%" paddingBottom={1} gap={2}>
          <box width="100%" paddingLeft={1} paddingRight={1}>
            <box flexDirection="column" width="100%" gap={0}>
              {projectName && (
                <text fg="magenta">
                  <strong>{projectName}</strong>
                </text>
              )}
              <text fg="gray" wrapMode="word">
                {isNarrow
                  ? 'Keyboard-first prompt mode'
                  : 'Keyboard-first prompt mode • Tab / Shift+Tab switches mode'}
              </text>
            </box>
          </box>

          <box width="100%" paddingLeft={1} paddingRight={1} gap={1}>
            <InteractiveInput
              question={prompt}
              questionId={prompt}
              predefinedOptions={predefinedOptions}
              searchRoot={searchRoot}
              onSubmit={handleInputSubmit}
              onInputActivity={keepInputVisible}
            />
          </box>
        </box>
      </scrollbox>

      {showCountdown && (
        <box marginTop={0} paddingLeft={1} paddingRight={1}>
          <PromptStatus
            value={progressValue}
            timeLeftSeconds={timeLeft}
            critical={timeLeft <= 10}
          />
        </box>
      )}
    </box>
  );
};

async function startUi() {
  await initialize();

  if (!options) {
    logger.error('Options could not be initialized. Cannot render App.');
    process.exit(1);
    return;
  }

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
  });
  const root = createRoot(renderer);

  let closed = false;
  const closeApp = () => {
    if (closed) {
      return;
    }

    closed = true;
    renderer.destroy();
    process.exit(0);
  };

  root.render(<App options={options} onExit={closeApp} />);
}

void startUi().catch((error) => {
  logger.error({ error }, 'Failed to start input UI');
  process.exit(1);
});
