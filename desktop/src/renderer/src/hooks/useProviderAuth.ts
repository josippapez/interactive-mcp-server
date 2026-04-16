import { useState, useCallback, useMemo } from 'react';
import type {
  AuthMethod,
  AuthPrompt,
  AuthorizeResult,
  ProviderActionResult,
} from '../../../preload/index';

// ─── State Machine Types ─────────────────────────────────────────────────────

/** Auth flow states. */
export type AuthStatus =
  | 'idle'
  | 'loading'
  | 'selecting-method'
  | 'prompts'
  | 'authorizing'
  | 'oauth-pending'
  | 'success'
  | 'error';

/** Current prompt state during the auth flow. */
export interface PromptState {
  /** Current prompts to display (filtered by `when` conditions). */
  prompts: AuthPrompt[];
  /** Collected inputs from previous prompts. */
  inputs: Record<string, string>;
  /** Currently pending input key (the next prompt to show). */
  currentKey: string | null;
}

/** State shape for the provider auth hook. */
export interface ProviderAuthState {
  /** Current status in the auth flow. */
  status: AuthStatus;
  /** The provider being authenticated. */
  providerId: string | null;
  /** Available auth methods for the provider. */
  methods: AuthMethod[];
  /** Index of the selected auth method. */
  selectedMethodIndex: number | null;
  /** The selected auth method details. */
  selectedMethod: AuthMethod | null;
  /** Prompt state for OAuth methods with prompts. */
  promptState: PromptState | null;
  /** OAuth authorization result (for auto/code flow). */
  oauthResult: AuthorizeResult | null;
  /** Error message if auth failed. */
  error: string | null;
}

/** Actions returned by the hook. */
export interface UseProviderAuthActions {
  /** Start the auth flow for a provider. */
  startAuth: (providerId: string) => Promise<void>;
  /** Select an auth method by index. */
  selectMethod: (methodIndex: number) => Promise<void>;
  /** Submit an API key (for 'api' type methods). */
  submitApiKey: (apiKey: string) => Promise<void>;
  /** Submit prompt inputs (for OAuth methods with prompts). */
  submitPromptInput: (key: string, value: string) => void;
  /** Proceed to OAuth authorize after all prompts are answered. */
  proceedToAuthorize: () => Promise<void>;
  /** Submit OAuth code (for 'code' method OAuth flow). */
  submitOAuthCode: (code: string) => Promise<void>;
  /** Complete auto OAuth callback (for 'auto' method OAuth flow). */
  completeAutoOAuth: () => Promise<void>;
  /** Reset the auth flow to idle state. */
  reset: () => void;
}

export type UseProviderAuthResult = ProviderAuthState & UseProviderAuthActions;

// ─── Pure Helper Functions ───────────────────────────────────────────────────

/**
 * Evaluate a `when` condition against collected inputs.
 */
export function evaluateWhenCondition(
  when: { key: string; op: 'eq' | 'neq'; value: string } | undefined,
  inputs: Record<string, string>,
): boolean {
  if (!when) return true;
  const actualValue = inputs[when.key] ?? '';
  if (when.op === 'eq') return actualValue === when.value;
  if (when.op === 'neq') return actualValue !== when.value;
  return true;
}

/**
 * Get the next pending prompt key based on collected inputs.
 * Returns null if all prompts are answered.
 */
export function getNextPromptKey(
  prompts: AuthPrompt[],
  inputs: Record<string, string>,
): string | null {
  for (const prompt of prompts) {
    // Skip prompts that don't satisfy their when condition
    if (!evaluateWhenCondition(prompt.when, inputs)) continue;
    // If we don't have an answer for this prompt, it's the next one
    if (!(prompt.key in inputs)) return prompt.key;
  }
  return null;
}

/**
 * Filter prompts to only those that satisfy their when conditions.
 */
export function filterVisiblePrompts(
  prompts: AuthPrompt[],
  inputs: Record<string, string>,
): AuthPrompt[] {
  return prompts.filter((p) => evaluateWhenCondition(p.when, inputs));
}

/**
 * Check if all required prompts are answered.
 */
export function areAllPromptsAnswered(
  prompts: AuthPrompt[],
  inputs: Record<string, string>,
): boolean {
  return getNextPromptKey(prompts, inputs) === null;
}

function getProviderError<T>(
  result: ProviderActionResult<T> | null | undefined,
  fallback: string,
): string {
  if (!result) return fallback;
  return result.error ?? fallback;
}

// ─── Initial State ───────────────────────────────────────────────────────────

const initialState: ProviderAuthState = {
  status: 'idle',
  providerId: null,
  methods: [],
  selectedMethodIndex: null,
  selectedMethod: null,
  promptState: null,
  oauthResult: null,
  error: null,
};

// ─── Hook Implementation ─────────────────────────────────────────────────────

/**
 * Hook to manage the provider authentication flow state machine.
 *
 * Flow states:
 * - idle → loading (startAuth)
 * - loading → selecting-method (multiple methods) or prompts/authorizing (single method)
 * - selecting-method → prompts or authorizing (selectMethod)
 * - prompts → authorizing (all prompts answered, proceedToAuthorize)
 * - authorizing → oauth-pending or success (depending on method type)
 * - oauth-pending → success (completeAutoOAuth or submitOAuthCode)
 * - Any state → error (on failure)
 * - Any state → idle (reset)
 */
export function useProviderAuth(): UseProviderAuthResult {
  const [state, setState] = useState<ProviderAuthState>(initialState);

  // ─── Actions ─────────────────────────────────────────────────────────────

  const startAuth = useCallback(async (providerId: string) => {
    setState({
      ...initialState,
      status: 'loading',
      providerId,
    });

    try {
      const authMethods = await window.api.fetchProviderAuthMethods();
      if (!authMethods) {
        setState((s) => ({
          ...s,
          status: 'error',
          error: 'Failed to fetch auth methods',
        }));
        return;
      }

      const methods = authMethods[providerId];
      if (!methods || methods.length === 0) {
        setState((s) => ({
          ...s,
          status: 'error',
          error: 'No auth methods available for this provider',
        }));
        return;
      }

      // If only one method, auto-select it
      if (methods.length === 1) {
        setState((s) => ({
          ...s,
          methods,
          selectedMethodIndex: 0,
          selectedMethod: methods[0],
          status: methods[0].type === 'api' ? 'prompts' : 'selecting-method',
          promptState:
            methods[0].type === 'api'
              ? {
                  prompts: [
                    {
                      type: 'text',
                      key: 'apiKey',
                      message: 'Enter your API key',
                      placeholder: 'sk-...',
                    },
                  ],
                  inputs: {},
                  currentKey: 'apiKey',
                }
              : methods[0].prompts && methods[0].prompts.length > 0
                ? {
                    prompts: methods[0].prompts,
                    inputs: {},
                    currentKey: getNextPromptKey(methods[0].prompts, {}),
                  }
                : null,
        }));
      } else {
        setState((s) => ({
          ...s,
          methods,
          status: 'selecting-method',
        }));
      }
    } catch (err) {
      setState((s) => ({
        ...s,
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      }));
    }
  }, []);

  const selectMethod = useCallback(
    async (methodIndex: number) => {
      const method = state.methods[methodIndex];
      if (!method) {
        setState((s) => ({
          ...s,
          status: 'error',
          error: 'Invalid method index',
        }));
        return;
      }

      if (method.type === 'api') {
        // API key flow: show a text prompt for the key
        setState((s) => ({
          ...s,
          selectedMethodIndex: methodIndex,
          selectedMethod: method,
          status: 'prompts',
          promptState: {
            prompts: [
              {
                type: 'text',
                key: 'apiKey',
                message: 'Enter your API key',
                placeholder: 'sk-...',
              },
            ],
            inputs: {},
            currentKey: 'apiKey',
          },
        }));
      } else {
        // OAuth flow
        if (method.prompts && method.prompts.length > 0) {
          // OAuth with prompts: show prompts first
          setState((s) => ({
            ...s,
            selectedMethodIndex: methodIndex,
            selectedMethod: method,
            status: 'prompts',
            promptState: {
              prompts: method.prompts!,
              inputs: {},
              currentKey: getNextPromptKey(method.prompts!, {}),
            },
          }));
        } else {
          // OAuth without prompts: go directly to authorize
          setState((s) => ({
            ...s,
            selectedMethodIndex: methodIndex,
            selectedMethod: method,
            status: 'authorizing',
          }));

          // Immediately trigger OAuth authorize
          try {
            const result = await window.api.authorizeProvider(
              state.providerId!,
              methodIndex,
            );
            if (!result.ok || !result.data) {
              setState((s) => ({
                ...s,
                status: 'error',
                error: getProviderError(result, 'OAuth authorization failed'),
              }));
              return;
            }

            setState((s) => ({
              ...s,
              status: 'oauth-pending',
              oauthResult: result.data,
            }));
          } catch (err) {
            setState((s) => ({
              ...s,
              status: 'error',
              error: err instanceof Error ? err.message : 'OAuth failed',
            }));
          }
        }
      }
    },
    [state.methods, state.providerId],
  );

  const submitApiKey = useCallback(
    async (apiKey: string) => {
      if (!state.providerId) {
        setState((s) => ({
          ...s,
          status: 'error',
          error: 'No provider selected',
        }));
        return;
      }

      setState((s) => ({ ...s, status: 'authorizing' }));

      try {
        const success = await window.api.setProviderApiKey(
          state.providerId,
          apiKey,
        );
        if (success) {
          setState((s) => ({ ...s, status: 'success' }));
        } else {
          setState((s) => ({
            ...s,
            status: 'error',
            error: 'Failed to set API key',
          }));
        }
      } catch (err) {
        setState((s) => ({
          ...s,
          status: 'error',
          error: err instanceof Error ? err.message : 'Failed to set API key',
        }));
      }
    },
    [state.providerId],
  );

  const submitPromptInput = useCallback((key: string, value: string) => {
    setState((s) => {
      if (!s.promptState) return s;

      const newInputs = { ...s.promptState.inputs, [key]: value };
      const nextKey = getNextPromptKey(s.promptState.prompts, newInputs);

      return {
        ...s,
        promptState: {
          ...s.promptState,
          inputs: newInputs,
          currentKey: nextKey,
        },
      };
    });
  }, []);

  const proceedToAuthorize = useCallback(async () => {
    if (!state.providerId || state.selectedMethodIndex === null) {
      setState((s) => ({
        ...s,
        status: 'error',
        error: 'No provider or method selected',
      }));
      return;
    }

    // Check if this is an API key submission
    if (state.selectedMethod?.type === 'api') {
      const apiKey = state.promptState?.inputs.apiKey;
      if (!apiKey) {
        setState((s) => ({
          ...s,
          status: 'error',
          error: 'API key is required',
        }));
        return;
      }
      await submitApiKey(apiKey);
      return;
    }

    // OAuth flow with prompts
    setState((s) => ({ ...s, status: 'authorizing' }));

    try {
      const result = await window.api.authorizeProvider(
        state.providerId,
        state.selectedMethodIndex,
        state.promptState?.inputs,
      );

      if (!result.ok || !result.data) {
        setState((s) => ({
          ...s,
          status: 'error',
          error: getProviderError(result, 'OAuth authorization failed'),
        }));
        return;
      }

      setState((s) => ({
        ...s,
        status: 'oauth-pending',
        oauthResult: result.data,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        status: 'error',
        error: err instanceof Error ? err.message : 'OAuth failed',
      }));
    }
  }, [
    state.providerId,
    state.selectedMethodIndex,
    state.selectedMethod,
    state.promptState,
    submitApiKey,
  ]);

  const submitOAuthCode = useCallback(
    async (code: string) => {
      if (!state.providerId || state.selectedMethodIndex === null) {
        setState((s) => ({
          ...s,
          status: 'error',
          error: 'No provider or method selected',
        }));
        return;
      }

      setState((s) => ({ ...s, status: 'authorizing' }));

      try {
        const result = await window.api.callbackProvider(
          state.providerId,
          state.selectedMethodIndex,
          code,
        );

        if (result.ok) {
          setState((s) => ({ ...s, status: 'success' }));
        } else {
          setState((s) => ({
            ...s,
            status: 'error',
            error: getProviderError(result, 'OAuth callback failed'),
          }));
        }
      } catch (err) {
        setState((s) => ({
          ...s,
          status: 'error',
          error: err instanceof Error ? err.message : 'OAuth callback failed',
        }));
      }
    },
    [state.providerId, state.selectedMethodIndex],
  );

  const completeAutoOAuth = useCallback(async () => {
    if (!state.providerId || state.selectedMethodIndex === null) {
      setState((s) => ({
        ...s,
        status: 'error',
        error: 'No provider or method selected',
      }));
      return;
    }

    setState((s) => ({ ...s, status: 'authorizing' }));

    try {
      // For auto OAuth, call callback without a code
      const result = await window.api.callbackProvider(
        state.providerId,
        state.selectedMethodIndex,
      );

      if (result.ok) {
        setState((s) => ({ ...s, status: 'success' }));
      } else {
        setState((s) => ({
          ...s,
          status: 'error',
          error: getProviderError(result, 'OAuth callback failed'),
        }));
      }
    } catch (err) {
      setState((s) => ({
        ...s,
        status: 'error',
        error: err instanceof Error ? err.message : 'OAuth callback failed',
      }));
    }
  }, [state.providerId, state.selectedMethodIndex]);

  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  // ─── Return Combined State + Actions ─────────────────────────────────────

  const result = useMemo<UseProviderAuthResult>(
    () => ({
      ...state,
      startAuth,
      selectMethod,
      submitApiKey,
      submitPromptInput,
      proceedToAuthorize,
      submitOAuthCode,
      completeAutoOAuth,
      reset,
    }),
    [
      state,
      startAuth,
      selectMethod,
      submitApiKey,
      submitPromptInput,
      proceedToAuthorize,
      submitOAuthCode,
      completeAutoOAuth,
      reset,
    ],
  );

  return result;
}
