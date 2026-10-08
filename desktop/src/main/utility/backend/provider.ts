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
  /** True when the model has zero input and output token cost. */
  isFree?: boolean;
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
  cost?: { input?: number; output?: number };
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

interface RawV2ProviderInfo {
  id: string;
  name: string;
  enabled?: false | unknown;
}

interface RawV2ModelInfo {
  id: string;
  name: string;
  providerID: string;
  enabled?: boolean;
  limit?: { context?: number; input?: number; output?: number };
  variants?: Array<{ id: string }>;
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
  /** True when the model has zero input and output token cost. */
  isFree?: boolean;
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
    // A model is "free" when both input and output token costs are zero.
    // The v2 model-list endpoint omits cost, so this only resolves from the
    // legacy `/provider` payload — leave undefined when cost is unknown.
    isFree:
      raw.cost === undefined
        ? undefined
        : (raw.cost.input ?? 0) === 0 && (raw.cost.output ?? 0) === 0,
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

function transformV2Model(raw: RawV2ModelInfo): ProviderModel {
  return transformModel(
    {
      id: raw.id,
      name: raw.name,
      providerID: raw.providerID,
      limit: raw.limit,
      capabilities: { reasoning: (raw.variants?.length ?? 0) > 0 },
      variants: raw.variants?.reduce<Record<string, unknown>>(
        (acc, variant) => {
          acc[variant.id] = true;
          return acc;
        },
        {},
      ),
    },
    raw.providerID,
  );
}

function mergeV2ModelMetadata(
  legacyModel: ProviderModel,
  v2Model: ProviderModel | undefined,
): ProviderModel {
  if (!v2Model) return legacyModel;

  const hasV2Variants = v2Model.variants && v2Model.variants.length > 0;

  return {
    ...legacyModel,
    contextWindow: legacyModel.contextWindow ?? v2Model.contextWindow,
    inputLimit: legacyModel.inputLimit ?? v2Model.inputLimit,
    outputLimit: legacyModel.outputLimit ?? v2Model.outputLimit,
    reasoning: hasV2Variants ? true : legacyModel.reasoning,
    variants: hasV2Variants ? v2Model.variants : legacyModel.variants,
    defaultVariant: hasV2Variants
      ? v2Model.defaultVariant
      : legacyModel.defaultVariant,
    // v2 model-list has no cost; keep the legacy cost-derived flag.
    isFree: legacyModel.isFree,
  };
}

export function mergeV2ProviderModelInfo(
  legacy: ProvidersInfo,
  v2Providers: RawV2ProviderInfo[] | null | undefined,
  v2Models: RawV2ModelInfo[] | null | undefined,
): ProvidersInfo {
  if (!v2Providers?.length || !v2Models?.length) return legacy;

  const v2ProviderById = new Map(
    v2Providers
      .filter((provider) => provider.enabled !== false)
      .map((provider) => [provider.id, provider]),
  );
  if (v2ProviderById.size === 0) return legacy;

  const v2ModelsByProvider = new Map<string, RawV2ModelInfo[]>();
  for (const model of v2Models) {
    if (model.enabled === false || !v2ProviderById.has(model.providerID)) {
      continue;
    }
    const bucket = v2ModelsByProvider.get(model.providerID) ?? [];
    bucket.push(model);
    v2ModelsByProvider.set(model.providerID, bucket);
  }

  return {
    ...legacy,
    providers: legacy.providers.map((provider) => {
      const v2ModelsForProvider = v2ModelsByProvider.get(provider.id);
      if (!v2ModelsForProvider?.length) return provider;
      const v2ModelById = new Map(
        v2ModelsForProvider.map((model) => [model.id, transformV2Model(model)]),
      );
      const legacyModelIds = new Set(provider.models.map((model) => model.id));
      const v2OnlyModels = v2ModelsForProvider
        .filter((model) => !legacyModelIds.has(model.id))
        .map(transformV2Model);

      return {
        ...provider,
        name: v2ProviderById.get(provider.id)?.name ?? provider.name,
        models: [
          ...provider.models.map((model) =>
            mergeV2ModelMetadata(model, v2ModelById.get(model.id)),
          ),
          ...v2OnlyModels,
        ],
      };
    }),
  };
}

async function fetchV2ProviderModelInfo(openCodePort: number): Promise<{
  providers: RawV2ProviderInfo[] | null;
  models: RawV2ModelInfo[] | null;
}> {
  try {
    const client = getClient(openCodePort);
    const [providersResponse, modelsResponse] = await Promise.all([
      client.v2.provider.list(undefined, { signal: AbortSignal.timeout(5000) }),
      client.v2.model.list(undefined, { signal: AbortSignal.timeout(5000) }),
    ]);
    return {
      providers: providersResponse.error
        ? null
        : ((providersResponse.data as RawV2ProviderInfo[] | undefined) ?? null),
      models: modelsResponse.error
        ? null
        : ((modelsResponse.data as RawV2ModelInfo[] | undefined) ?? null),
    };
  } catch {
    return { providers: null, models: null };
  }
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

    const legacyInfo: ProvidersInfo = {
      providers,
      connectedProviderIds: data.connected,
      defaults: data.default,
    };
    const v2Info = await fetchV2ProviderModelInfo(openCodePort);
    const info = mergeV2ProviderModelInfo(
      legacyInfo,
      v2Info.providers,
      v2Info.models,
    );
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
        isFree: model.isFree,
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
        isFree: model.isFree,
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
    // OAuth device-code flows (e.g. GitHub Copilot) require the user to
    // visit a browser, paste a code, and authorize — easily 30-60s+. A 10s
    // timeout would abort before the user finishes, leaving auth.json
    // updated on disk but the in-app modal in an error state. 5 min is a
    // generous upper bound for human-in-the-loop OAuth.
    const response = await client.provider.oauth.authorize(
      {
        providerID: providerId,
        method,
        inputs,
      },
      { signal: AbortSignal.timeout(300_000) },
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
    // See note on authorizeProvider — the same human-in-the-loop window
    // applies to the callback step.
    const response = await client.provider.oauth.callback(
      {
        providerID: providerId,
        method,
        code,
      },
      { signal: AbortSignal.timeout(300_000) },
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
