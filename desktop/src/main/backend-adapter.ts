import type { AgentBackend } from './settings';
import {
  detectClaudeSdkRuntime,
  type ClaudeSdkRuntimeStatus,
} from './claude-sdk-runtime';

export interface BackendAdapter {
  backend: AgentBackend;
  supportsSessionHierarchy: boolean;
  supportsProviderInjection: boolean;
  runtime: ClaudeSdkRuntimeStatus | null;
}

export async function getBackendAdapter(
  backend: AgentBackend,
): Promise<BackendAdapter> {
  if (backend === 'opencode') {
    return {
      backend,
      supportsSessionHierarchy: true,
      supportsProviderInjection: true,
      runtime: null,
    };
  }

  if (backend === 'claude_sdk') {
    const runtime = await detectClaudeSdkRuntime();
    return {
      backend,
      supportsSessionHierarchy: false,
      supportsProviderInjection: runtime.available,
      runtime,
    };
  }

  return {
    backend: 'standalone',
    supportsSessionHierarchy: false,
    supportsProviderInjection: false,
    runtime: null,
  };
}
