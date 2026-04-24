import {
  normalizeReasoningVariant,
  normalizeReasoningVariants,
} from '../../../shared/reasoning-variant';
import { getClient } from './sdk-client';
import { setModelContextLimit } from './context-tracking';
import { getMainRpc } from './rpc';
import { errorMessage } from '../../utils/errors';

/**
 * OpenCode provider/model API integration.
 *
 * Provides functions to fetch and cache available AI providers and models
 * from the OpenCode API using the SDK, enabling model selection in the UI.
 */

// ─── Provider Auth Types ─────────────────────────────────────────────────────

/** Conditional display logic for prompts. */
export interface PromptWhen {
  key: string;
  op: 'eq' | 'neq';
  value: string;
}

/** Text input prompt for auth flow. */
export interface TextPrompt {
  type: 'text';
  key: string;
  message: string;
  placeholder?: string;
  when?: PromptWhen;
}

/** Select/dropdown prompt for auth flow. */
export interface SelectPrompt {
  type: 'select';
  key: string;
  message: string;
  options: Array<{ label: string; value: string; hint?: string }>;
  when?: PromptWhen;
}

/** Union of all prompt types. */
export type AuthPrompt = TextPrompt | SelectPrompt;

/** Auth method definition for a provider. */
export interface AuthMethod {
  type: 'oauth' | 'api';
  label: string;
  prompts?: AuthPrompt[];
}

/** Result from OAuth authorize endpoint. */
export interface AuthorizeResult {
  url: string;
  method: 'auto' | 'code';
  instructions: string;
}

export interface ProviderActionResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

// ─── Provider/Model Types ────────────────────────────────────────────────────

/** Model definition from OpenCode API. */
export interface ProviderModel {
  id: string;
  name: string;
  contextWindow?: number;
  inputLimit?: number;
  outputLimit?: number;
  reasoning?: boolean;
  variants?: string[];
  defaultVariant?: string;
}

/** Provider definition from OpenCode API. */
export interface Provider {
  id: string;
  name: string;
  models: ProviderModel[];
}

/** Raw model from OpenCode API (before transformation). */
interface RawModel {
  id: string;
  name: string;
  limit?: { context?: number; input?: number; output?: number };
  capabilities?: { reasoning?: boolean };
  variants?: Record<string, unknown>;
  providerID?: string;
}

/** Raw provider from OpenCode API (before transformation). */
interface RawProvider {
  id: string;
  name: string;
  models: Record<string, RawModel>;
}

/** Response shape from GET /provider. */
interface RawProvidersResponse {
  all: RawProvider[];
  default: Record<string, string>;
  connected: string[];
}

/** Full provider info including connected status. */
export interface ProvidersInfo {
  providers: Provider[];
  connectedProviderIds: string[];
  defaults: Record<string, string>;
}

/** Model with provider info attached (flattened for UI). */
export interface Model {
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
}

// ─── In-memory cache ─────────────────────────────────────────────────────────

let _cachedProviders: Provider[] | null = null;
/** Timestamp (ms) of the last successful providers fetch. 0 means "none". */
let _cachedProvidersAt = 0;
/** Fully-shaped providers-info cache (providers + connected + defaults). */
let _cachedProvidersInfo: ProvidersInfo | null = null;
/** TTL for the providers-info cache — 30s is plenty for connect/disconnect UX. */
const PROVIDERS_CACHE_TTL_MS = 30_000;

// ─── Push notification to renderer ───────────────────────────────────────────
//
// Whenever a fresh providers-info payload is fetched, we forward it to the
// renderer via the bridge's `to-renderer` event (channel
// `providers-info:updated`). Main-side code subscribes via a bridge listener
// in `main/index.ts`.

/** Debounce token for coalesced push emission. */
let _pushDebounceTimer: NodeJS.Timeout | null = null;
/** Most recently captured payload awaiting flush. */
let _pendingPushPayload: ProvidersInfo | null = null;
const PUSH_DEBOUNCE_MS = 50;

function emitProvidersInfo(info: ProvidersInfo): void {
  _pendingPushPayload = info;
  if (_pushDebounceTimer) return;
  _pushDebounceTimer = setTimeout(() => {
    _pushDebounceTimer = null;
    const payload = _pendingPushPayload;
    _pendingPushPayload = null;
    if (!payload) return;
    try {
      getMainRpc().emit('to-renderer', {
        channel: 'providers-info:updated',
        payload,
      });
    } catch {
      // Bridge unavailable (e.g. during shutdown) — skip silently.
    }
  }, PUSH_DEBOUNCE_MS);
}

// ─── Helper functions ────────────────────────────────────────────────────────

function inferDefaultVariant(
  modelId: string,
  providerId: string | undefined,
  variants: string[] | undefined,
): string | undefined {
  if (!variants || variants.length === 0) return undefined;

  const normalizedVariants = normalizeReasoningVariants(variants);
  if (!normalizedVariants || normalizedVariants.length === 0) return undefined;

  const id = modelId.toLowerCase();

  if (
    id.includes('gpt-5') &&
    !id.includes('gpt-5-chat') &&
    !id.includes('gpt-5-pro')
  ) {
    if (normalizedVariants.includes('medium')) return 'medium';
  }

  if (id.includes('gemini-3') || id.includes('gemini3')) {
    if (normalizedVariants.includes('high')) return 'high';
  }

  if (id.includes('claude')) {
    if (normalizedVariants.includes('high')) return 'high';
  }

  if (/\bo[1-3]/.test(id) && !id.includes('o1-mini')) {
    if (normalizedVariants.includes('medium')) return 'medium';
  }

  if (
    providerId?.toLowerCase().includes('openrouter') &&
    id.includes('gemini-3')
  ) {
    if (normalizedVariants.includes('high')) return 'high';
  }

  if (normalizedVariants.includes('medium')) return 'medium';
  if (normalizedVariants.includes('high')) return 'high';
  if (normalizedVariants.includes('xhigh')) return 'xhigh';

  return normalizedVariants[0];
}

function transformModel(raw: RawModel, providerId?: string): ProviderModel {
  const variants =
    raw.variants && Object.keys(raw.variants).length > 0
      ? normalizeReasoningVariants(Object.keys(raw.variants))
      : undefined;

  const model: ProviderModel = {
    id: raw.id,
    name: raw.name,
    contextWindow: raw.limit?.context,
    inputLimit: raw.limit?.input,
    outputLimit: raw.limit?.output,
    reasoning: raw.capabilities?.reasoning ?? false,
    variants,
    defaultVariant: normalizeReasoningVariant(
      inferDefaultVariant(raw.id, providerId ?? raw.providerID, variants),
    ),
  };

  if (raw.limit?.context) {
    // We're already in the utility process — call context-tracking directly
    // instead of round-tripping through the bridge.
    try {
      setModelContextLimit(
        raw.id,
        {
          contextWindow: raw.limit.context,
          inputLimit: raw.limit.input,
          outputLimit: raw.limit.output,
        },
        providerId ?? raw.providerID,
      );
    } catch {
      // Non-fatal — tracker falls back to DEFAULT_CONTEXT_WINDOW.
    }
  }

  return model;
}

function transformProvider(raw: RawProvider): Provider {
  return {
    id: raw.id,
    name: raw.name,
    models: Object.values(raw.models).map((m) => transformModel(m, raw.id)),
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch all providers and their models from the OpenCode API using SDK.
 */
export async function fetchProviders(
  openCodePort: number,
): Promise<Provider[] | null> {
  try {
    const client = getClient(openCodePort);
    const response = await client.provider.list(undefined, {
      signal: AbortSignal.timeout(5000),
    });

    if (response.error) return null;

    const data = response.data as RawProvidersResponse | undefined;
    if (!data?.all) return null;

    const providers = data.all.map(transformProvider);
    _cachedProviders = providers;
    return providers;
  } catch {
    return null;
  }
}

/**
 * Fetch full provider info including connected status.
 *
 * Uses a 30s in-memory TTL cache so rapid consecutive calls (e.g. three
 * UI surfaces mounting at once) make a single HTTP round-trip. Call
 * `clearProviderCache()` to invalidate after an auth change.
 */
export async function fetchProvidersInfo(
  openCodePort: number,
): Promise<ProvidersInfo | null> {
  if (
    _cachedProvidersInfo !== null &&
    Date.now() - _cachedProvidersAt < PROVIDERS_CACHE_TTL_MS
  ) {
    return _cachedProvidersInfo;
  }

  try {
    const client = getClient(openCodePort);
    const response = await client.provider.list(undefined, {
      signal: AbortSignal.timeout(5000),
    });

    if (response.error) return null;

    const data = response.data as RawProvidersResponse | undefined;
    if (!data?.all || data.all.length === 0) {
      // Do NOT poison the 30s TTL cache with an empty result — during
      // cold-start the SDK call can race the OpenCode HTTP server coming
      // up and resolve with an empty provider list. Leaving the cache
      // untouched lets the next caller (renderer retry / post-health
      // warmup) issue a fresh fetch.
      return null;
    }

    const providers = data.all.map(transformProvider);
    _cachedProviders = providers;

    const info: ProvidersInfo = {
      providers,
      connectedProviderIds: data.connected,
      defaults: data.default,
    };
    _cachedProvidersInfo = info;
    _cachedProvidersAt = Date.now();

    // Notify subscribers (renderer push) so the UI stays hydrated even when
    // the TTL would have otherwise expired with no consumer.
    emitProvidersInfo(info);

    return info;
  } catch {
    return null;
  }
}

/**
 * Force a fresh providers-info fetch, bypassing the TTL cache. Used by the
 * background refresh interval and by auth callbacks to re-hydrate after
 * connect/disconnect. On success, notifies push subscribers.
 */
export async function refreshProvidersInfo(
  openCodePort: number,
): Promise<ProvidersInfo | null> {
  _cachedProvidersAt = 0;
  return fetchProvidersInfo(openCodePort);
}

/**
 * Fetch all models from all providers, flattened into a single array.
 */
export async function fetchModels(openCodePort: number): Promise<Model[]> {
  const providers = await fetchProviders(openCodePort);
  if (!providers) return [];

  const models: Model[] = [];
  for (const provider of providers) {
    for (const model of provider.models) {
      models.push({
        id: model.id,
        name: model.name,
        providerId: provider.id,
        providerName: provider.name,
        contextWindow: model.contextWindow,
        inputLimit: model.inputLimit,
        outputLimit: model.outputLimit,
        reasoning: model.reasoning,
        variants: model.variants,
        defaultVariant: model.defaultVariant,
      });
    }
  }

  return models;
}

export function getProviderById(providerId: string): Provider | null {
  if (!_cachedProviders) return null;
  return _cachedProviders.find((p) => p.id === providerId) ?? null;
}

export function getModelById(modelId: string): Model | null {
  if (!_cachedProviders) return null;

  for (const provider of _cachedProviders) {
    const model = provider.models.find((m) => m.id === modelId);
    if (model) {
      return {
        id: model.id,
        name: model.name,
        providerId: provider.id,
        providerName: provider.name,
        contextWindow: model.contextWindow,
        inputLimit: model.inputLimit,
        outputLimit: model.outputLimit,
        reasoning: model.reasoning,
        variants: model.variants,
        defaultVariant: model.defaultVariant,
      };
    }
  }

  return null;
}

export function getCachedProviders(): Provider[] | null {
  return _cachedProviders;
}

export function clearProviderCache(): void {
  _cachedProviders = null;
  _cachedProvidersInfo = null;
  _cachedProvidersAt = 0;
}

// ─── Provider Auth API ───────────────────────────────────────────────────────

/**
 * Fetch available auth methods for all providers using SDK.
 */
export async function fetchProviderAuthMethods(
  openCodePort: number,
): Promise<Record<string, AuthMethod[]> | null> {
  try {
    const client = getClient(openCodePort);
    const response = await client.provider.auth(undefined, {
      signal: AbortSignal.timeout(5000),
    });

    if (response.error) return null;

    return (response.data as Record<string, AuthMethod[]>) ?? null;
  } catch {
    return null;
  }
}

/**
 * Start OAuth authorization flow for a provider using SDK.
 */
export async function authorizeProvider(
  openCodePort: number,
  providerId: string,
  method: number,
  inputs?: Record<string, string>,
): Promise<ProviderActionResult<AuthorizeResult>> {
  try {
    const client = getClient(openCodePort);
    const response = await client.provider.oauth.authorize(
      {
        providerID: providerId,
        method,
        inputs,
      },
      { signal: AbortSignal.timeout(10000) },
    );

    if (response.error) {
      return { ok: false, error: String(response.error) };
    }

    const data = (response.data as AuthorizeResult | undefined) ?? undefined;
    if (!data) {
      return { ok: false, error: 'Provider returned no authorization data' };
    }

    return { ok: true, data };
  } catch (err: unknown) {
    return {
      ok: false,
      error: errorMessage(err),
    };
  }
}

/**
 * Complete OAuth callback for a provider using SDK.
 */
export async function callbackProvider(
  openCodePort: number,
  providerId: string,
  method: number,
  code?: string,
): Promise<ProviderActionResult<true>> {
  try {
    const client = getClient(openCodePort);
    const response = await client.provider.oauth.callback(
      {
        providerID: providerId,
        method,
        code,
      },
      { signal: AbortSignal.timeout(10000) },
    );

    if (response.error) {
      return { ok: false, error: String(response.error) };
    }

    if (response.data !== true) {
      return { ok: false, error: 'Provider callback did not complete' };
    }

    // Auth state changed — invalidate the providers-info TTL cache so the
    // next fetch sees the new connected-provider set.
    clearProviderCache();
    // Fire-and-forget refresh so the renderer is notified of the new
    // connected state without waiting for a component to refetch.
    void fetchProvidersInfo(openCodePort).catch(() => {
      // Swallow — the next consumer fetch will retry.
    });
    return { ok: true, data: true };
  } catch (err: unknown) {
    return {
      ok: false,
      error: errorMessage(err),
    };
  }
}

/**
 * Set an API key for a provider using SDK.
 */
export async function setProviderApiKey(
  openCodePort: number,
  providerId: string,
  apiKey: string,
): Promise<boolean> {
  try {
    const client = getClient(openCodePort);
    const response = await client.auth.set(
      {
        providerID: providerId,
        auth: { type: 'api', key: apiKey },
      },
      { signal: AbortSignal.timeout(5000) },
    );

    if (response.error) return false;
    // Auth state changed — invalidate cache.
    clearProviderCache();
    void fetchProvidersInfo(openCodePort).catch(() => {
      // Swallow — the next consumer fetch will retry.
    });
    return true;
  } catch {
    return false;
  }
}
