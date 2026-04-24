import { sendSessionStatus } from '../renderer-channel';
import { injectOpenCodeMessage } from '../injector';
import { injectProjectMcps, recordInjectedMcps } from '../mcp-inject';
import { invalidateSessionTree } from '../session-tree-service';

interface SessionTreeUpdateOptions {
  connectionId: string;
  channelName: string;
  openCodeSessionId: string | null;
  parentSessionId: string | null;
  baseDirectory: string | null | undefined;
  supportsProviderInjection: boolean;
  supportsSessionHierarchy: boolean;
}

interface ProjectMcpInjectionOptions {
  connectionId: string;
  openCodeSessionId: string | null;
  baseDirectory: string;
  getOpenCodePort: () => number;
}

interface StartupContextInjectionOptions {
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

  // Pull-on-invalidation: the renderer refetches the full tree via
  // `get-session-tree` when we fire this event. No cache mutation, no
  // optimistic node emission required.
  invalidateSessionTree();
}

export function startProjectMcpInjection(
  options: ProjectMcpInjectionOptions,
): void {
  void (async () => {
    const sessionIdForTracking =
      options.openCodeSessionId ?? options.connectionId;
    sendSessionStatus(
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
          options.openCodeSessionId,
          `Failed to parse project config: ${result.parseError}`,
          'error',
        );
        return;
      }

      if (result.injectedMcps.length > 0) {
        recordInjectedMcps(sessionIdForTracking, result.injectedMcps);
        sendSessionStatus(
          options.openCodeSessionId,
          `Injected ${result.injectedMcps.length} project MCP(s): ${result.injectedMcps.join(', ')}`,
          'success',
        );
      }

      const errors = result.results.filter(
        (entry: { status: string }) => entry.status === 'error',
      );
      if (errors.length === 0) {
        return;
      }

      sendSessionStatus(
        options.openCodeSessionId,
        `Failed to inject ${errors.length} MCP(s): ${errors.map((entry: { name: string }) => entry.name).join(', ')}`,
        'error',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendSessionStatus(
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
      options.openCodeSessionId,
      'Injecting startup context into OpenCode session…',
      'working',
    );

    void (async () => {
      // Inject startup context (instructions/skills) as a `noReply` user
      // message containing a `<system-reminder>` block. We deliberately do NOT
      // use OpenCode's `system` field: per `session/llm.ts` the per-call
      // `system` only persists while the injected message is `lastUser`, so
      // it disappears the moment the user sends their next real message.
      // Storing the reminder in the message parts persists it in `messages[]`
      // and OpenCode replays it on every step via `MessageV2.toModelMessages`.
      // `noReply: true` keeps the agent from generating a turn for it.
      const injectionResult = await injectOpenCodeMessage(
        options.openCodeSessionId!,
        options.startupContextMessage, // user message body — `<system-reminder>` block
        undefined,
        options.getOpenCodePort(),
        undefined, // mcpServerPort
        true, // noReply — context drop, don't trigger an agent reply
        undefined, // modelOverride
        undefined, // systemMessage — intentionally unused; see comment above
      );

      if (injectionResult.ok) {
        sendSessionStatus(
          options.openCodeSessionId,
          'Startup context injected into OpenCode session',
          'success',
        );
        return;
      }

      sendSessionStatus(
        options.openCodeSessionId,
        `Startup context injection failed: ${injectionResult.error ?? 'unknown error'}`,
        'error',
      );
    })();
    return;
  }

  sendSessionStatus(
    options.openCodeSessionId,
    `Startup context prepared (${options.backendName} mode)`,
    'info',
  );

  if (!options.runtime || options.runtime.available) {
    return;
  }

  sendSessionStatus(
    options.openCodeSessionId,
    options.runtime.message,
    'error',
  );
}
