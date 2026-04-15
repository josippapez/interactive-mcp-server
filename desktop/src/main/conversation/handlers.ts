/**
 * IPC handlers for conversation mirroring.
 *
 * Exposes conversation data from providers to the renderer process.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { getConversationRegistry } from './registry';
import { getOpenCodeConversationProvider } from './opencode-provider';
import type { ConversationMessage } from './types';

export interface ConversationHandlerDeps {
  getMainWindow: () => BrowserWindow | null;
  getOpenCodePort: () => number;
}

/**
 * Initialize conversation providers and start listening for events.
 */
export function initializeConversationProviders(
  deps: ConversationHandlerDeps,
): void {
  const registry = getConversationRegistry();
  const openCodeProvider = getOpenCodeConversationProvider(
    deps.getOpenCodePort(),
  );

  // Register OpenCode provider
  registry.register(openCodeProvider);

  // Live conversation events are already forwarded from the main OpenCode event
  // subscribers (`bus-events.ts` and `tree-manager.ts`). Avoid subscribing here,
  // otherwise the renderer receives duplicate message/part events and churns.

  // Start all providers
  void registry.startAll().catch((err) => {
    console.warn('[conversation] Failed to start providers:', err);
  });
}

/**
 * Update the OpenCode port for conversation fetching.
 */
export function updateConversationPort(port: number): void {
  const provider = getOpenCodeConversationProvider(port);
  provider.setPort(port);
}

/**
 * Stop all conversation providers (cleanup on app quit).
 */
export function stopConversationProviders(): void {
  getConversationRegistry().stopAll();
}

/**
 * Register IPC handlers for conversation mirroring.
 */
export function registerConversationHandlers(): void {
  // Fetch conversation messages for a session
  ipcMain.handle(
    'fetch-conversation-messages',
    async (
      _event,
      data: { sessionId: string; limit?: number },
    ): Promise<ConversationMessage[]> => {
      const registry = getConversationRegistry();
      return registry.fetchMessages(data.sessionId, data.limit);
    },
  );

  // Check if conversation provider is available
  ipcMain.handle(
    'is-conversation-available',
    async (_event, providerId?: string): Promise<boolean> => {
      const registry = getConversationRegistry();
      if (providerId) {
        const provider = registry.get(providerId);
        return provider ? provider.isAvailable() : false;
      }
      // Check if any provider is available
      const providers = registry.all();
      for (const provider of providers) {
        if (await provider.isAvailable()) {
          return true;
        }
      }
      return false;
    },
  );
}
