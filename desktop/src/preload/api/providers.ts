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
            isFree?: boolean;
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
          isFree?: boolean;
        }[];
      }[];
      connectedProviderIds: string[];
      defaults: Record<string, string>;
    } | null> => ipcRenderer.invoke('fetch-providers-info'),

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

    /**
     * Subscribe to providers-info push updates from main. Fired after the
     * initial cold-start warmup, after auth callbacks succeed, and on the
     * periodic background refresh. Lets the renderer hydrate without
     * requiring any component to mount `useProviders()` first.
     *
     * Returns a cleanup function; call it in the effect's cleanup phase.
     */
    onProvidersInfoUpdated: (
      callback: (info: {
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
            isFree?: boolean;
          }[];
        }[];
        connectedProviderIds: string[];
        defaults: Record<string, string>;
      }) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        info: {
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
              isFree?: boolean;
            }[];
          }[];
          connectedProviderIds: string[];
          defaults: Record<string, string>;
        },
      ) => callback(info);
      ipcRenderer.on('providers-info:updated', handler);
      return () => {
        ipcRenderer.removeListener('providers-info:updated', handler);
      };
    },
  };
}
