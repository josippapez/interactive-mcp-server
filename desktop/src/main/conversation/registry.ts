/**
 * Conversation provider registry.
 *
 * Manages multiple conversation providers and routes requests
 * to the appropriate provider based on session metadata.
 */

import type {
  ConversationProvider,
  ConversationProviderRegistry,
  ConversationMessage,
  ConversationEventCallback,
} from './types';

class ConversationRegistry implements ConversationProviderRegistry {
  private providers = new Map<string, ConversationProvider>();
  private sessionProviderMap = new Map<string, string>();

  register(provider: ConversationProvider): void {
    this.providers.set(provider.providerId, provider);
  }

  unregister(providerId: string): void {
    const provider = this.providers.get(providerId);
    if (provider) {
      provider.stop();
      this.providers.delete(providerId);
    }
  }

  get(providerId: string): ConversationProvider | undefined {
    return this.providers.get(providerId);
  }

  all(): ConversationProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Associate a session with a specific provider.
   */
  setSessionProvider(sessionId: string, providerId: string): void {
    this.sessionProviderMap.set(sessionId, providerId);
  }

  /**
   * Get the provider for a session.
   * Falls back to the first available provider if no mapping exists.
   */
  getForSession(sessionId: string): ConversationProvider | undefined {
    const providerId = this.sessionProviderMap.get(sessionId);
    if (providerId) {
      return this.providers.get(providerId);
    }
    // Fall back to first available provider
    return this.providers.values().next().value;
  }

  /**
   * Fetch messages from the appropriate provider for a session.
   */
  async fetchMessages(
    sessionId: string,
    limit?: number,
  ): Promise<ConversationMessage[]> {
    const provider = this.getForSession(sessionId);
    if (!provider) {
      return [];
    }
    return provider.fetchMessages(sessionId, limit);
  }

  /**
   * Subscribe to conversation events for a session.
   * Routes to the appropriate provider.
   */
  subscribe(
    sessionId: string | null,
    callback: ConversationEventCallback,
  ): () => void {
    const unsubscribes: Array<() => void> = [];

    if (sessionId) {
      // Subscribe to specific provider for this session
      const provider = this.getForSession(sessionId);
      if (provider) {
        unsubscribes.push(provider.subscribe(sessionId, callback));
      }
    } else {
      // Subscribe to all providers for global events
      for (const provider of this.providers.values()) {
        unsubscribes.push(provider.subscribe(null, callback));
      }
    }

    return () => {
      for (const unsub of unsubscribes) {
        unsub();
      }
    };
  }

  /**
   * Start all registered providers.
   */
  async startAll(): Promise<void> {
    const promises = Array.from(this.providers.values()).map((p) => p.start());
    await Promise.all(promises);
  }

  /**
   * Stop all registered providers.
   */
  stopAll(): void {
    for (const provider of this.providers.values()) {
      provider.stop();
    }
  }
}

// ─── Singleton Instance ─────────────────────────────────────────────────────

let _registry: ConversationRegistry | null = null;

export function getConversationRegistry(): ConversationRegistry {
  if (!_registry) {
    _registry = new ConversationRegistry();
  }
  return _registry;
}

export { ConversationRegistry };
