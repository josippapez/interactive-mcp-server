import path from 'path';
import { fileURLToPath } from 'url';
import fsPromises from 'fs/promises';
import { watch, FSWatcher } from 'fs';
import os from 'os';
import crypto from 'crypto';
// Updated import to use @ alias
import {
  USER_INPUT_TIMEOUT_SECONDS,
  USER_INPUT_TIMEOUT_SENTINEL,
} from '@/constants.js';
import logger from '../../utils/logger.js';
import { spawnDetachedTerminal } from '../../utils/spawn-detached-terminal.js';
import { SEARCH_ROOT_ENV_KEY } from '../../utils/search-root.js';

// Get the directory name of the current module
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Define cleanupResources outside the promise to be accessible in the final catch
async function cleanupResources(
  heartbeatPath: string,
  responsePath: string,
  optionsPath: string, // Added optionsPath
) {
  await Promise.allSettled([
    fsPromises.unlink(responsePath).catch(() => {}),
    fsPromises.unlink(heartbeatPath).catch(() => {}),
    fsPromises.unlink(optionsPath).catch(() => {}), // Cleanup options file
    // Potentially add cleanup for other session-related files if needed
  ]);
}

/**
 * Display a command window with a prompt and return user input
 * @param projectName Name of the project requesting input (used for title)
 * @param promptMessage Message to display to the user
 * @param timeoutSeconds Timeout in seconds
 * @param showCountdown Whether to show a countdown timer
 * @param baseDirectory Base directory for autocomplete/search root
 * @param predefinedOptions Optional list of predefined options for quick selection
 * @returns User input, timeout sentinel, or empty string if process exits unexpectedly
 */
export async function getCmdWindowInput(
  projectName: string,
  promptMessage: string,
  timeoutSeconds: number = USER_INPUT_TIMEOUT_SECONDS, // Use constant as default
  showCountdown: boolean = true,
  baseDirectory: string,
  predefinedOptions?: string[],
): Promise<string> {
  // Create a temporary file for the detached process to write to
  const sessionId = crypto.randomBytes(8).toString('hex');
  const tempDir = os.tmpdir();
  const tempFilePath = path.join(tempDir, `cmd-ui-response-${sessionId}.txt`);
  const heartbeatFilePath = path.join(
    tempDir,
    `cmd-ui-heartbeat-${sessionId}.txt`,
  );
  const optionsFilePath = path.join(
    tempDir,
    `cmd-ui-options-${sessionId}.json`,
  ); // New options file path

  return new Promise<string>((resolve) => {
    // Wrap the async setup logic in an IIFE
    void (async () => {
      // Path to the UI script (will be in the same directory after compilation)
      const uiScriptPath = path.join(__dirname, 'ui.js');

      // Gather options
      const options = {
        projectName,
        prompt: promptMessage,
        timeout: timeoutSeconds,
        showCountdown,
        searchRoot: baseDirectory,
        sessionId,
        outputFile: tempFilePath,
        heartbeatFile: heartbeatFilePath, // Pass heartbeat file path too
        predefinedOptions,
      };

      let ui;

      // Moved setup into try block
      try {
        logger.info(
          {
            sessionId,
            timeoutSeconds,
            showCountdown,
            hasPredefinedOptions:
              Array.isArray(predefinedOptions) && predefinedOptions.length > 0,
          },
          'Starting command input UI with timeout configuration.',
        );

        // Write options to the file before spawning
        await fsPromises.writeFile(
          optionsFilePath,
          JSON.stringify(options),
          'utf8',
        );

        // Platform-specific detached terminal spawning
        const encodedSearchRoot = Buffer.from(baseDirectory, 'utf8').toString(
          'base64',
        );
        ui = spawnDetachedTerminal({
          scriptPath: uiScriptPath,
          args: [sessionId, tempDir, encodedSearchRoot],
          darwinArgs: [sessionId, tempDir, encodedSearchRoot],
          macLauncherPath: path.join(
            tempDir,
            `interactive-mcp-launch-${sessionId}.command`,
          ),
          macFallbackLogMessage: 'Fallback open -a Terminal failed',
          env: {
            [SEARCH_ROOT_ENV_KEY]: baseDirectory,
          },
        });

        let watcher: FSWatcher | null = null;
        let timeoutHandle: NodeJS.Timeout | null = null;
        let heartbeatInterval: NodeJS.Timeout | null = null;
        let heartbeatFileSeen = false; // Track if we've ever seen the heartbeat file
        const startTime = Date.now(); // Record start time for initial grace period
        const startupGraceMs = timeoutSeconds * 1000 + 5000;

        // Define cleanupAndResolve inside the promise scope
        const cleanupAndResolve = async (response: string) => {
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
          }
          if (watcher) {
            watcher.close();
            watcher = null;
          }
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
          }

          // Pass optionsFilePath to cleanupResources
          await cleanupResources(
            heartbeatFilePath,
            tempFilePath,
            optionsFilePath,
          );

          resolve(response);
        };

        // Listen for process exit events - moved definition before IIFE start
        const handleExit = (code?: number | null) => {
          // If the process exited with a non-zero code and watcher/timeout still exist
          if (code !== 0 && (watcher || timeoutHandle)) {
            void cleanupAndResolve('');
          }
        };

        const handleError = () => {
          if (watcher || timeoutHandle) {
            // Only cleanup if not already cleaned up
            void cleanupAndResolve('');
          }
        };

        ui.on('exit', handleExit);
        ui.on('error', handleError);

        // Unref the child process so the parent can exit independently
        ui.unref();

        // Create an empty temp file before watching for user response
        await fsPromises.writeFile(tempFilePath, '', 'utf8'); // Use renamed import

        // Wait briefly for the heartbeat file to potentially be created
        await new Promise((res) => setTimeout(res, 500));

        // Watch for content being written to the temp file
        watcher = watch(tempFilePath, (eventType: string) => {
          // Removed async
          if (eventType === 'change') {
            // Read the response and cleanup
            // Use an async IIFE inside the non-async callback
            void (async () => {
              try {
                const data = await fsPromises.readFile(tempFilePath, 'utf8'); // Use renamed import
                if (data) {
                  const response = data.trim();
                  if (response === USER_INPUT_TIMEOUT_SENTINEL) {
                    logger.info(
                      { sessionId, timeoutSeconds },
                      'Input UI reported timeout sentinel.',
                    );
                  }
                  void cleanupAndResolve(response); // Mark promise as intentionally ignored
                }
              } catch (readError) {
                logger.error({ err: readError }, 'Error reading response file');
                void cleanupAndResolve('');
              }
            })();
          }
        });

        // Start heartbeat check interval
        heartbeatInterval = setInterval(() => {
          // Removed async
          // Use an async IIFE inside the non-async callback
          void (async () => {
            try {
              const stats = await fsPromises.stat(heartbeatFilePath); // Use renamed import
              const now = Date.now();
              // If file hasn't been modified in the last 3 seconds, assume dead
              if (now - stats.mtime.getTime() > 3000) {
                logger.info(
                  `Heartbeat file ${heartbeatFilePath} hasn't been updated recently. Process likely exited.`, // Added logger info
                );
                void cleanupAndResolve(''); // Mark promise as intentionally ignored
              } else {
                heartbeatFileSeen = true; // Mark that we've seen the file
              }
            } catch (err: unknown) {
              // Type err as unknown
              // Check if err is an error object with a code property
              if (err && typeof err === 'object' && 'code' in err) {
                const error = err as { code: string }; // Type assertion
                if (error.code === 'ENOENT') {
                  // File not found
                  if (heartbeatFileSeen) {
                    // File existed before but is now gone, assume dead
                    logger.info(
                      `Heartbeat file ${heartbeatFilePath} not found after being seen. Process likely exited.`, // Added logger info
                    );
                    void cleanupAndResolve(''); // Mark promise as intentionally ignored
                  } else if (Date.now() - startTime > startupGraceMs) {
                    // File never appeared before configured timeout budget passed, assume dead
                    logger.info(
                      `Heartbeat file ${heartbeatFilePath} never appeared within ${Math.floor(startupGraceMs / 1000)}s. Process likely failed to start or was blocked by permissions.`,
                    );
                    void cleanupAndResolve(USER_INPUT_TIMEOUT_SENTINEL);
                  }
                  // Otherwise, file just hasn't appeared yet, wait longer
                } else {
                  // Removed check for !== 'ENOENT' as it's implied
                  // Log other errors and resolve
                  logger.error({ error }, 'Heartbeat check error');
                  void cleanupAndResolve('');
                }
              } else {
                // Handle cases where err is not an object with a code property
                logger.error(
                  { error: err },
                  'Unexpected heartbeat check error',
                );
                void cleanupAndResolve(''); // Mark promise as intentionally ignored
              }
            }
          })();
        }, 1500); // Check every 1.5 seconds

        // Timeout to stop watching if no response within limit
        timeoutHandle = setTimeout(
          () => {
            logger.info(
              `Input timeout reached after ${timeoutSeconds} seconds.`,
            ); // Added logger info
            void cleanupAndResolve(USER_INPUT_TIMEOUT_SENTINEL); // Mark promise as intentionally ignored
          },
          timeoutSeconds * 1000 + 5000,
        ); // Add a bit more buffer
      } catch (setupError) {
        logger.error({ error: setupError }, 'Error during cmd-input setup');
        // Ensure cleanup happens even if setup fails
        // Pass optionsFilePath to cleanupResources
        await cleanupResources(
          heartbeatFilePath,
          tempFilePath,
          optionsFilePath,
        );
        resolve(''); // Resolve with empty string after attempting cleanup
      }
    })(); // Execute the IIFE
  });
}
