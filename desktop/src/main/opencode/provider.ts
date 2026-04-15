import {
  normalizeReasoningVariant,
  normalizeReasoningVariants,
} from '../../shared/reasoning-variant';
import {
  buildOpenCodePortCandidates,
  fetchJsonFromAllReachable,
} from './endpoints';
import { setModelContextLimit } from './context-tracking';

/**
 * OpenCode provider/model API integration.
 *
 * Provides functions to fetch and cache available AI providers and models
 * from the OpenCode API, enabling model selection in the UI.
 *
 * API: GET /provider returns { all: Provider[], default: Record<string,string>, connected: string[] }
 * API: GET /provider/auth returns Record<string, AuthMethod[]>
 * API: POST /provider/:id/oauth/authorize returns { url, method: "auto"|"code", instructions }
 * API: POST /provider/:id/oauth/callback returns boolean
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

// ─── Provider/Model Types ────────────────────────────────────────────────────

/** Model definition from OpenCode API. */
export interface ProviderModel {
  id: string;
  name: string;
  contextWindow?: number;
  inputLimit?: number;
  outputLimit?: number;
  /** Whether this model supports reasoning/thinking capabilities. */
  reasoning?: boolean;
  /** Available effort/variant levels for reasoning models (e.g., 'low', 'medium', 'high'). */
  variants?: string[];
  /** The recommended default variant/effort level for this model. */
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

function mergeVariantRecords(
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!existing && !incoming) return undefined;
  return {
    ...(existing ?? {}),
    ...(incoming ?? {}),
  };
}

function mergeRawModels(existing: RawModel, incoming: RawModel): RawModel {
  const mergedVariants = mergeVariantRecords(
    existing.variants,
    incoming.variants,
  );
  const existingReasoning = existing.capabilities?.reasoning ?? false;
  const incomingReasoning = incoming.capabilities?.reasoning ?? false;

  return {
    ...existing,
    ...incoming,
    id: incoming.id || existing.id,
    name: incoming.name || existing.name,
    limit: {
      context: incoming.limit?.context ?? existing.limit?.context,
      input: incoming.limit?.input ?? existing.limit?.input,
      output: incoming.limit?.output ?? existing.limit?.output,
    },
    capabilities:
      existing.capabilities || incoming.capabilities
        ? {
            reasoning: existingReasoning || incomingReasoning,
          }
        : undefined,
    variants: mergedVariants,
    providerID: incoming.providerID ?? existing.providerID,
  };
}

function mergeRawProvidersResponses(
  responses: RawProvidersResponse[],
): RawProvidersResponse {
  const providersById = new Map<string, RawProvider>();
  const connected = new Set<string>();
  const defaults: Record<string, string> = {};

  for (const response of responses) {
    for (const provider of response.all) {
      const existing = providersById.get(provider.id);
      if (!existing) {
        providersById.set(provider.id, {
          id: provider.id,
          name: provider.name,
          models: { ...provider.models },
        });
        continue;
      }

      for (const [modelId, incomingModel] of Object.entries(provider.models)) {
        const existingModel = existing.models[modelId];
        if (!existingModel) {
          existing.models[modelId] = incomingModel;
          continue;
        }
        existing.models[modelId] = mergeRawModels(existingModel, incomingModel);
      }
    }

    for (const providerId of response.connected) {
      connected.add(providerId);
    }

    for (const [providerId, modelId] of Object.entries(response.default)) {
      if (!(providerId in defaults) && modelId) {
        defaults[providerId] = modelId;
      }
    }
  }

  return {
    all: Array.from(providersById.values()),
    connected: Array.from(connected),
    default: defaults,
  };
}

/** Full provider info including connected status. */
export interface ProvidersInfo {
  providers: Provider[];
  /** List of provider IDs that are authenticated/connected. */
  connectedProviderIds: string[];
  /** Default model ID per provider. */
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
  /** Whether this model supports reasoning/thinking capabilities. */
  reasoning?: boolean;
  /** Available effort/variant levels for reasoning models (e.g., 'low', 'medium', 'high'). */
  variants?: string[];
  /** The recommended default variant/effort level for this model. */
  defaultVariant?: string;
}

// ─── In-memory cache ─────────────────────────────────────────────────────────

let _cachedProviders: Provider[] | null = null;

// ─── Helper functions ────────────────────────────────────────────────────────

/**
 * Infer the default variant/effort level for a reasoning model.
 *
 * This follows OpenCode's internal defaults from ProviderTransform.options():
 * - GPT-5 models: "medium" (set in transform.ts line 830)
 * - Claude models: "high" (most common usage)
 * - Gemini-3 models: "high" (set in transform.ts lines 766, 797)
 * - Other reasoning models: "medium" if available, else first available
 *
 * @param modelId - The model ID
 * @param providerId - The provider ID
 * @param variants - Available variant keys
 * @returns The recommended default variant, or undefined if none
 */
function inferDefaultVariant(
  modelId: string,
  providerId: string | undefined,
  variants: string[] | undefined,
): string | undefined {
  if (!variants || variants.length === 0) return undefined;

  const normalizedVariants = normalizeReasoningVariants(variants);
  if (!normalizedVariants || normalizedVariants.length === 0) return undefined;

  const id = modelId.toLowerCase();
  const pId = providerId?.toLowerCase() ?? '';

  // GPT-5 models default to "medium" (matches OpenCode transform.ts)
  if (
    id.includes('gpt-5') &&
    !id.includes('gpt-5-chat') &&
    !id.includes('gpt-5-pro')
  ) {
    if (normalizedVariants.includes('medium')) return 'medium';
  }

  // Gemini-3 models default to "high" (matches OpenCode transform.ts)
  if (id.includes('gemini-3') || id.includes('gemini3')) {
    if (normalizedVariants.includes('high')) return 'high';
  }

  // Claude models commonly use "high" for extended thinking
  if (id.includes('claude')) {
    if (normalizedVariants.includes('high')) return 'high';
  }

  // o1/o3 reasoning models - prefer "medium" for balanced performance
  if (/\bo[1-3]/.test(id) && !id.includes('o1-mini')) {
    if (normalizedVariants.includes('medium')) return 'medium';
  }

  // OpenRouter provider with gemini-3
  if (pId.includes('openrouter') && id.includes('gemini-3')) {
    if (normalizedVariants.includes('high')) return 'high';
  }

  // Default fallback: prefer "medium" if available, then "high"
  if (normalizedVariants.includes('medium')) return 'medium';
  if (normalizedVariants.includes('high')) return 'high';
  if (normalizedVariants.includes('xhigh')) return 'xhigh';

  // Last resort: return the first available variant
  return normalizedVariants[0];
}

/**
 * Transform raw OpenCode model to our ProviderModel format.
 */
function transformModel(raw: RawModel, providerId?: string): ProviderModel {
  // Extract variant keys if reasoning model
  const variants =
    raw.variants && Object.keys(raw.variants).length > 0
      ? normalizeReasoningVariants(Object.keys(raw.variants))
      : undefined;

  // Debug: log variants for reasoning models to verify API response
  // if (variants && variants.length > 0) {
  //   console.log(
  //     `[provider] Model "${raw.id}" (provider: ${providerId ?? raw.providerID ?? 'unknown'}) variants from API:`,
  //     variants,
  //   );
  // }

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
    setModelContextLimit(
      raw.id,
      {
        contextWindow: raw.limit.context,
        inputLimit: raw.limit.input,
        outputLimit: raw.limit.output,
      },
      providerId ?? raw.providerID,
    );
  }

  return model;
}

/**
 * Transform raw OpenCode provider to our Provider format.
 */
function transformProvider(raw: RawProvider): Provider {
  const models: ProviderModel[] = [];
  for (const model of Object.values(raw.models)) {
    models.push(transformModel(model, raw.id));
  }

  return {
    id: raw.id,
    name: raw.name,
    models,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch all providers and their models from the OpenCode API.
 * Results are cached for subsequent lookups.
 *
 * @param openCodePort - The port OpenCode is running on
 * @returns Array of providers, or null if the request fails
 */
export async function fetchProviders(
  openCodePort: number,
): Promise<Provider[] | null> {
  const ports = buildOpenCodePortCandidates(openCodePort);

  try {
    const responses = await fetchJsonFromAllReachable<RawProvidersResponse>(
      ports,
      '/provider',
      5000,
    );
    if (responses.length === 0) return null;
    const data = mergeRawProvidersResponses(
      responses.map((response) => response.data),
    );

    // Transform raw providers to our format
    const providers: Provider[] = data.all.map(transformProvider);
    _cachedProviders = providers;
    return providers;
  } catch {
    return null;
  }
}

/**
 * Fetch full provider info including connected status.
 * Use this when you need to know which providers are authenticated.
 *
 * @param openCodePort - The port OpenCode is running on
 * @returns Provider info including connected IDs, or null on failure
 */
export async function fetchProvidersInfo(
  openCodePort: number,
): Promise<ProvidersInfo | null> {
  const ports = buildOpenCodePortCandidates(openCodePort);

  try {
    const responses = await fetchJsonFromAllReachable<RawProvidersResponse>(
      ports,
      '/provider',
      5000,
    );
    if (responses.length === 0) return null;
    const data = mergeRawProvidersResponses(
      responses.map((response) => response.data),
    );

    // Transform raw providers to our format
    const providers: Provider[] = data.all.map(transformProvider);
    _cachedProviders = providers;

    return {
      providers,
      connectedProviderIds: data.connected,
      defaults: data.default,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch all models from all providers, flattened into a single array.
 * Each model includes its provider information.
 *
 * @param openCodePort - The port OpenCode is running on
 * @returns Array of models with provider info, or empty array on failure
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

/**
 * Get a provider by ID from the cache.
 * Requires fetchProviders to have been called first.
 *
 * @param providerId - The provider ID to look up
 * @returns The provider, or null if not found
 */
export function getProviderById(providerId: string): Provider | null {
  if (!_cachedProviders) return null;
  return _cachedProviders.find((p) => p.id === providerId) ?? null;
}

/**
 * Get a model by ID from the cache.
 * Requires fetchProviders to have been called first.
 *
 * @param modelId - The model ID to look up
 * @returns The model with provider info, or null if not found
 */
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

/**
 * Get the cached providers without making a network request.
 *
 * @returns Cached providers, or null if not yet fetched
 */
export function getCachedProviders(): Provider[] | null {
  return _cachedProviders;
}

/**
 * Clear the provider cache.
 * Useful for testing or forcing a refresh.
 */
export function clearProviderCache(): void {
  _cachedProviders = null;
}

// ─── Provider Auth API ───────────────────────────────────────────────────────

/**
 * Fetch available auth methods for all providers.
 *
 * @param openCodePort - The port OpenCode is running on
 * @returns Record mapping provider ID to available auth methods, or null on failure
 */
export async function fetchProviderAuthMethods(
  openCodePort: number,
): Promise<Record<string, AuthMethod[]> | null> {
  const ports = buildOpenCodePortCandidates(openCodePort);

  try {
    const responses = await fetchJsonFromAllReachable<
      Record<string, AuthMethod[]>
    >(ports, '/provider/auth', 5000);
    if (responses.length === 0) return null;

    const merged: Record<string, AuthMethod[]> = {};
    for (const response of responses) {
      Object.assign(merged, response.data);
    }

    return merged;
  } catch {
    return null;
  }
}

/**
 * Start OAuth authorization flow for a provider.
 *
 * @param openCodePort - The port OpenCode is running on
 * @param providerId - The provider to authorize
 * @param method - The auth method index (from fetchProviderAuthMethods)
 * @param inputs - Optional inputs from prompts (for OAuth methods with prompts)
 * @returns Authorization result with URL and method, or null on failure
 */
export async function authorizeProvider(
  openCodePort: number,
  providerId: string,
  method: number,
  inputs?: Record<string, string>,
): Promise<AuthorizeResult | null> {
  const ports = buildOpenCodePortCandidates(openCodePort);

  for (const port of ports) {
    try {
      const res = await fetch(
        `http://localhost:${port}/provider/${providerId}/oauth/authorize`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method, inputs }),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!res.ok) continue;

      const data = (await res.json()) as AuthorizeResult | undefined;
      return data ?? null;
    } catch {
      // failure isolation: try next endpoint
    }
  }

  return null;
}

/**
 * Complete OAuth callback for a provider.
 *
 * @param openCodePort - The port OpenCode is running on
 * @param providerId - The provider to complete auth for
 * @param method - The auth method index
 * @param code - Optional OAuth code (required for "code" method, not for "auto")
 * @returns true if callback succeeded, false otherwise
 */
export async function callbackProvider(
  openCodePort: number,
  providerId: string,
  method: number,
  code?: string,
): Promise<boolean> {
  const ports = buildOpenCodePortCandidates(openCodePort);

  for (const port of ports) {
    try {
      const res = await fetch(
        `http://localhost:${port}/provider/${providerId}/oauth/callback`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method, code }),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!res.ok) continue;

      const result = (await res.json()) as boolean;
      return result === true;
    } catch {
      // failure isolation: try next endpoint
    }
  }

  return false;
}

/**
 * Set an API key for a provider.
 * This is the "api" auth type flow — user pastes their API key.
 *
 * @param openCodePort - The port OpenCode is running on
 * @param providerId - The provider to set the API key for
 * @param apiKey - The API key to store
 * @returns true if the key was set successfully, false otherwise
 */
export async function setProviderApiKey(
  openCodePort: number,
  providerId: string,
  apiKey: string,
): Promise<boolean> {
  const ports = buildOpenCodePortCandidates(openCodePort);

  for (const port of ports) {
    try {
      const res = await fetch(`http://localhost:${port}/auth/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerID: providerId,
          auth: { type: 'api', key: apiKey },
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return true;
    } catch {
      // failure isolation: try next endpoint
    }
  }

  return false;
}
