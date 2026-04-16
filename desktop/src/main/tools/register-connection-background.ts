import type { BrowserWindow } from 'electron';
import { sendSessionStatus } from '../ipc/channel';
import { injectOpenCodeMessage } from '../opencode/injector';
import { injectProjectMcps, recordInjectedMcps } from '../opencode/mcp-inject';
import type { SessionNodeData } from '../session/tree-manager';
import {
  refreshSessionTreeCache,
  triggerSessionTreeUpdate,
} from '../session/tree-manager';

type GetWindow = () => BrowserWindow | null;

interface SessionTreeUpdateOptions {
  getWindow: GetWindow;
  connectionId: string;
  channelName: string;
  openCodeSessionId: string | null;
  parentSessionId: string | null;
  baseDirectory: string | null | undefined;
  supportsProviderInjection: boolean;
  supportsSessionHierarchy: boolean;
}

interface ProjectMcpInjectionOptions {
  getWindow: GetWindow;
  connectionId: string;
  openCodeSessionId: string | null;
  baseDirectory: string;
  getOpenCodePort: () => number;
}

interface StartupContextInjectionOptions {
  getWindow: GetWindow;
  connectionId: string;
  openCodeSessionId: string | null;
  startupContextMessage: string;
  getOpenCodePort: () => number;
  backendName: string;
  runtime?: {
    available: boolean;
    message: string;
  } | null;
  supportsProviderInjection: boolean;
}

export async function updateSessionTreeAfterRegistration(
  options: SessionTreeUpdateOptions,
): Promise<void> {
  if (!options.supportsSessionHierarchy) {
    return;
  }

  emitOptimisticRegistrationNode(options);
  await triggerSessionTreeUpdate(options.getWindow);

  if (!options.supportsProviderInjection) {
    return;
  }

  void refreshSessionTreeCorrectively(options.getWindow);
}

function emitOptimisticRegistrationNode(
  options: SessionTreeUpdateOptions,
): void {
  if (!options.openCodeSessionId) {
    return;
  }

  const win = options.getWindow();
  if (!win || win.isDestroyed()) {
    return;
  }

  const now = Date.now();
  const optimisticNode: SessionNodeData = {
    openCodeSessionId: options.openCodeSessionId,
    openCodeParentId: options.parentSessionId,
    title: options.channelName,
    directory: options.baseDirectory ?? '',
    createdAt: now,
    updatedAt: now,
    depth: options.parentSessionId ? 1 : 0,
    connectionId: options.connectionId,
    channelName: options.channelName,
    hasMcpChannel: true,
    baseDirectory: options.baseDirectory ?? null,
    registeredParentSessionId: options.parentSessionId,
    providerType: 'opencode',
    vcsInfo: null,
  };

  win.webContents.send('session-node-created-optimistic', optimisticNode);
}

async function refreshSessionTreeCorrectively(
  getWindow: GetWindow,
): Promise<void> {
  try {
    await refreshSessionTreeCache();
    await triggerSessionTreeUpdate(getWindow);
  } catch (error) {
    console.warn(
      '[register_connection] corrective session-tree refresh failed',
      error,
    );
  }
}

export function startProjectMcpInjection(
  options: ProjectMcpInjectionOptions,
): void {
  void (async () => {
    const sessionIdForTracking =
      options.openCodeSessionId ?? options.connectionId;
    sendSessionStatus(
      options.getWindow(),
      options.openCodeSessionId,
      'Checking for project MCPs...',
      'working',
    );

    try {
      const result = await injectProjectMcps({
        baseDirectory: options.baseDirectory,
        openCodePort: options.getOpenCodePort(),
      });

      if (!result.configFound) {
        return;
      }

      if (result.parseError) {
        sendSessionStatus(
          options.getWindow(),
          options.openCodeSessionId,
          `Failed to parse project config: ${result.parseError}`,
          'error',
        );
        return;
      }

      if (result.injectedMcps.length > 0) {
        recordInjectedMcps(sessionIdForTracking, result.injectedMcps);
        sendSessionStatus(
          options.getWindow(),
          options.openCodeSessionId,
          `Injected ${result.injectedMcps.length} project MCP(s): ${result.injectedMcps.join(', ')}`,
          'success',
        );
      }

      const errors = result.results.filter((entry) => entry.status === 'error');
      if (errors.length === 0) {
        return;
      }

      sendSessionStatus(
        options.getWindow(),
        options.openCodeSessionId,
        `Failed to inject ${errors.length} MCP(s): ${errors.map((entry) => entry.name).join(', ')}`,
        'error',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendSessionStatus(
        options.getWindow(),
        options.openCodeSessionId,
        `MCP injection failed: ${message}`,
        'error',
      );
    }
  })();
}

export function startStartupContextInjection(
  options: StartupContextInjectionOptions,
): void {
  if (options.supportsProviderInjection && options.openCodeSessionId) {
    sendSessionStatus(
      options.getWindow(),
      options.openCodeSessionId,
      'Injecting startup context into OpenCode session…',
      'working',
    );

    void (async () => {
      // Inject startup context (instructions/skills) as a system message
      // so it appears in the model's system prompt rather than as a user message.
      const injectionResult = await injectOpenCodeMessage(
        options.openCodeSessionId!,
        '', // Empty user message - content goes in system field
        undefined,
        options.getOpenCodePort(),
        undefined, // mcpServerPort
        true, // noReply
        undefined, // modelOverride
        options.startupContextMessage, // systemMessage - injected into model's system prompt
      );

      if (injectionResult.ok) {
        sendSessionStatus(
          options.getWindow(),
          options.openCodeSessionId,
          'Startup context injected into OpenCode session',
          'success',
        );
        return;
      }

      sendSessionStatus(
        options.getWindow(),
        options.openCodeSessionId,
        `Startup context injection failed: ${injectionResult.error ?? 'unknown error'}`,
        'error',
      );
    })();
    return;
  }

  sendSessionStatus(
    options.getWindow(),
    options.openCodeSessionId,
    `Startup context prepared (${options.backendName} mode)`,
    'info',
  );

  if (!options.runtime || options.runtime.available) {
    return;
  }

  sendSessionStatus(
    options.getWindow(),
    options.openCodeSessionId,
    options.runtime.message,
    'error',
  );
}
