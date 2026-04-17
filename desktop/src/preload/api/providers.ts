import { ipcRenderer } from 'electron';
import type {
  AuthMethod,
  AuthorizeResult,
  ProviderActionResult,
  ProviderStatus,
} from './types';

export function createProvidersApi() {
  return {
    // Provider backend status/capabilities
    getProviderStatus: (): Promise<ProviderStatus> =>
      ipcRenderer.invoke('get-provider-status'),

    // ─── Provider/Model API ─────────────────────────────────────────────────────

    /**
     * Fetch all available providers and their models from OpenCode.
     */
    fetchProviders: (): Promise<
      | {
          id: string;
          name: string;
          models: {
            id: string;
            name: string;
            contextWindow?: number;
            inputLimit?: number;
            outputLimit?: number;
            reasoning?: boolean;
            variants?: string[];
            defaultVariant?: string;
          }[];
        }[]
      | null
    > => ipcRenderer.invoke('fetch-providers'),

    /**
     * Fetch full providers info including connected status.
     * Use this when you need to know which providers are authenticated.
     */
    fetchProvidersInfo: (): Promise<{
      providers: {
        id: string;
        name: string;
        models: {
          id: string;
          name: string;
          contextWindow?: number;
          inputLimit?: number;
          outputLimit?: number;
          reasoning?: boolean;
          variants?: string[];
          defaultVariant?: string;
        }[];
      }[];
      connectedProviderIds: string[];
      defaults: Record<string, string>;
    } | null> => ipcRenderer.invoke('fetch-providers-info'),

    /**
     * Fetch all models from all providers, flattened with provider info.
     */
    fetchModels: (): Promise<
      {
        id: string;
        name: string;
        providerId: string;
        providerName: string;
        contextWindow?: number;
        inputLimit?: number;
        outputLimit?: number;
        reasoning?: boolean;
        variants?: string[];
        defaultVariant?: string;
      }[]
    > => ipcRenderer.invoke('fetch-models'),

    /**
     * Fetch available auth methods for all providers.
     */
    fetchProviderAuthMethods: (): Promise<Record<
      string,
      AuthMethod[]
    > | null> => ipcRenderer.invoke('fetch-provider-auth-methods'),

    /**
     * Start OAuth authorization flow for a provider.
     */
    authorizeProvider: (
      providerId: string,
      method: number,
      inputs?: Record<string, string>,
    ): Promise<ProviderActionResult<AuthorizeResult>> =>
      ipcRenderer.invoke('authorize-provider', { providerId, method, inputs }),

    /**
     * Complete OAuth callback for a provider.
     */
    callbackProvider: (
      providerId: string,
      method: number,
      code?: string,
    ): Promise<ProviderActionResult<true>> =>
      ipcRenderer.invoke('callback-provider', { providerId, method, code }),

    /**
     * Set an API key for a provider.
     */
    setProviderApiKey: (providerId: string, apiKey: string): Promise<boolean> =>
      ipcRenderer.invoke('set-provider-api-key', { providerId, apiKey }),
  };
}
