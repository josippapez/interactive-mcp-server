import React, { useState, useEffect } from 'react';
import { useProviders } from '../../hooks/useProviders';
import { useProviderAuthMethods } from '../../hooks/useProviderAuthMethods';
import { ProviderAuthButton } from '../auth';
import { Button } from '../ui/button';

interface ProviderAuthSectionProps {
  /** Whether OpenCode backend is enabled. */
  isOpenCodeEnabled: boolean;
}

/**
 * Provider authentication management section for the Settings page.
 * Displays all providers with their connection status and auth buttons.
 * Connected providers show a green checkmark, disconnected providers show auth buttons.
 */
export default function ProviderAuthSection({
  isOpenCodeEnabled,
}: ProviderAuthSectionProps): React.ReactElement {
  const {
    providers,
    isLoading: providersLoading,
    refresh: refreshProviders,
    isConnected,
  } = useProviders(isOpenCodeEnabled);
  const {
    authMethods,
    isLoading: authLoading,
    hasAuthMethods,
    refresh: refreshAuth,
  } = useProviderAuthMethods(isOpenCodeEnabled);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Refresh provider list when auth succeeds
  const handleAuthSuccess = () => {
    void refreshProviders();
    void refreshAuth();
    setRefreshTrigger((t) => t + 1);
  };

  // Fetch providers on mount when enabled
  useEffect(() => {
    if (isOpenCodeEnabled) {
      void refreshProviders();
      void refreshAuth();
    }
  }, [isOpenCodeEnabled, refreshProviders, refreshAuth, refreshTrigger]);

  if (!isOpenCodeEnabled) {
    return (
      <div className="py-4">
        <p className="text-xs text-[var(--color-text-faint)] italic">
          Provider authentication is only available when using the OpenCode
          backend. Change the Agent Backend setting above to enable this
          feature.
        </p>
      </div>
    );
  }

  const isLoading = providersLoading || authLoading;

  // Split providers into connected and not connected
  const connectedProviders = providers.filter((p) => isConnected(p.id));
  const disconnectedProviders = providers.filter((p) => !isConnected(p.id));

  // Among disconnected, split into those with auth methods and those without
  const disconnectedWithAuth = disconnectedProviders.filter((p) =>
    hasAuthMethods(p.id),
  );
  const disconnectedWithoutAuth = disconnectedProviders.filter(
    (p) => !hasAuthMethods(p.id),
  );

  return (
    <div className="py-4 border-t border-[var(--color-border)] mt-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="text-sm font-medium text-[var(--color-text)]">
            AI Providers
          </h4>
          <p className="text-xs text-[var(--color-text-faint)] mt-0.5">
            Manage provider connections. Add API keys or sign in with OAuth.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void refreshProviders();
            void refreshAuth();
          }}
          disabled={isLoading}
          aria-label="Refresh providers"
        >
          {isLoading ? '...' : '↻'}
        </Button>
      </div>

      {isLoading && providers.length === 0 ? (
        <div className="py-4 text-center text-sm text-[var(--color-text-faint)]">
          Loading providers...
        </div>
      ) : providers.length === 0 ? (
        <div className="py-4 text-center text-sm text-[var(--color-text-faint)]">
          <p>No providers available.</p>
          <p className="text-xs mt-1">
            Make sure OpenCode is running and accessible.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Connected providers */}
          {connectedProviders.length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-[var(--color-text-muted)] mb-2 uppercase tracking-wider">
                Connected ({connectedProviders.length})
              </h5>
              <div className="space-y-1.5">
                {connectedProviders.map((provider) => (
                  <div
                    key={provider.id}
                    className="flex items-center justify-between px-3 py-2.5 rounded-md border border-green-500/20 bg-green-500/5"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-lg shrink-0">
                        {getProviderIcon(provider.id)}
                      </span>
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-[var(--color-text)] block truncate">
                          {provider.name}
                        </span>
                        <span className="text-xs text-[var(--color-text-faint)]">
                          {provider.models.length} model
                          {provider.models.length !== 1 ? 's' : ''} available
                        </span>
                      </div>
                    </div>
                    <span className="flex items-center gap-1 text-xs text-green-500 shrink-0">
                      <svg
                        className="h-3.5 w-3.5"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <span>Connected</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Disconnected providers with auth methods available */}
          {disconnectedWithAuth.length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-[var(--color-text-muted)] mb-2 uppercase tracking-wider">
                Available ({disconnectedWithAuth.length})
              </h5>
              <div className="space-y-1.5">
                {disconnectedWithAuth.map((provider) => (
                  <div
                    key={provider.id}
                    className="flex items-center justify-between px-3 py-2.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-lg shrink-0">
                        {getProviderIcon(provider.id)}
                      </span>
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-[var(--color-text)] block truncate">
                          {provider.name}
                        </span>
                        <span className="text-xs text-[var(--color-text-faint)]">
                          {provider.models.length} model
                          {provider.models.length !== 1 ? 's' : ''} &middot; Not
                          connected
                        </span>
                      </div>
                    </div>
                    <div className="shrink-0">
                      <ProviderAuthButton
                        providerId={provider.id}
                        providerName={provider.name}
                        variant="compact"
                        onSuccess={handleAuthSuccess}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Disconnected providers without auth methods (collapsed) */}
          {disconnectedWithoutAuth.length > 0 && (
            <details className="mt-1">
              <summary className="text-xs text-[var(--color-text-faint)] cursor-pointer hover:text-[var(--color-text-muted)]">
                {disconnectedWithoutAuth.length} other provider
                {disconnectedWithoutAuth.length !== 1 ? 's' : ''} (no auth
                configured)
              </summary>
              <div className="mt-2 space-y-1">
                {disconnectedWithoutAuth.map((provider) => (
                  <div
                    key={provider.id}
                    className="flex items-center justify-between px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]/50"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm">
                        {getProviderIcon(provider.id)}
                      </span>
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {provider.name}
                      </span>
                    </div>
                    <span className="text-xs text-[var(--color-text-faint)]">
                      {provider.models.length} model
                      {provider.models.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Get an icon/emoji for a provider based on its ID.
 */
function getProviderIcon(providerId: string): string {
  const icons: Record<string, string> = {
    anthropic: '🅰️',
    openai: '🤖',
    google: '🔮',
    gemini: '💎',
    amazon: '📦',
    bedrock: '🪨',
    azure: '☁️',
    'azure-openai': '☁️',
    groq: '⚡',
    mistral: '🌬️',
    cohere: '🔗',
    ollama: '🦙',
    local: '💻',
    custom: '⚙️',
    copilot: '🐙',
    'github-copilot': '🐙',
    openrouter: '🔀',
    xai: '✖️',
  };
  return icons[providerId.toLowerCase()] ?? '🔌';
}
