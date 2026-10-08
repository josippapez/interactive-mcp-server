import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { staleSessionError } from './connection-guard';
import {
  type BackgroundSubagentRecord,
  getRegisteredConnectionBySessionId,
  getBackgroundSubagentRecord,
  getBackgroundSubagentRecordBySessionId,
  listBackgroundSubagentRecords,
  upsertBackgroundSubagent,
  upsertRegisteredConnection,
} from '../database';
import {
  sessionCreate,
  type SessionCreateBody,
  sessionGet,
  sessionMessages,
  sessionPromptAsync,
  sessionStatus,
  sessionWait,
  type SessionPromptBody,
} from '../session-api';
import { toProviderReasoningVariant } from '../../../../shared/reasoning-variant';
import { abortOpenCodeSession } from '../abort';
import { injectOpenCodeMessage } from '../injector';
import { fetchProvidersInfo, type ProvidersInfo } from '../provider';
import {
  getOpenCodePort,
  invalidateSessionTree,
} from '../session-tree-service';
import { buildBackgroundSubagentMessage } from './background-subagent-message';

type BackgroundSubagentState = BackgroundSubagentRecord['status'];

type LiveStatus = 'busy' | 'idle' | 'error' | 'unknown';
type LiveStatusMap = Record<string, { type?: string } | undefined>;

type ConnectedBackgroundSubagentModels = ProvidersInfo;
type BackgroundSubagentPreset = 'deep' | 'labor' | 'fast';
type ModelRecommendation = {
  providerId: string;
  modelId: string;
  recommendedFor: Array<
    'deep-reasoning' | 'precise-review' | 'predefined-labor' | 'fast-check'
  >;
  suggestedVariant?: string;
};

type BackgroundSubagentParentSelection =
  | {
      ok: true;
      parentSessionId: string;
      reason: 'explicit';
    }
  | { ok: false; error: string };

const INVALID_MODEL_SELECTION_MESSAGE =
  'Invalid model selection. Use action="models" and choose a connected provider/model from the returned list.';
const STALLED_AFTER_MS = 10 * 60_000;

const backgroundSubagents = new Map<string, BackgroundSubagentRecord>();
const backgroundSubagentsBySessionId = new Map<
  string,
  BackgroundSubagentRecord
>();
const knownBackgroundSubagentSessionIds = new Set<string>();
let knownBackgroundSubagentSessionsLoaded = false;

export const TOOL_DESCRIPTION = `<description>
Start and inspect real background OpenCode subagents without blocking the current agent turn.
This tool creates child OpenCode sessions and sends their prompt with prompt_async, then returns immediately with a background id and child session id.
</description>

<importantNotes>
- (!important!) This is desktop/OpenCode-only and requires the current session to have an openCodeSessionId.
- (!important!) "start" returns immediately; use "status" or "output" later to check progress and collect results.
- (!important!) Use action="wait" when you have no independent work to do and want to block until one background child becomes idle instead of repeatedly polling status/output.
- (!important!) The child session appears in the desktop session tree, so humans can inspect it while it runs.
- (!important!) Completion is detected from OpenCode session status events and injected into the parent session with noReply=false so the waiting parent agent resumes; polling is only a manual fallback.
- (!important!) Use this instead of the harness Task tool when you need true fire-and-forget parallel work from the desktop MCP server.
- (!important!) When both this tool and a native task/subagent tool are available, prefer this tool for background subagent work so the child session is visible in the desktop app, can be inspected by humans, and can be coordinated with status/output/cancel actions.
- (!important!) Keep prompts bounded and include a clear final deliverable; background output is retrieved from the child session's assistant messages.
- (!important!) Model selection is optional. Omit providerId/modelId to let the child session use the current OpenCode connection defaults, call action="models" and pass one connected provider/model pair from that returned list, or pass preset="deep"|"labor"|"fast" to auto-select from recommendations.
- (!important!) For deeper thinking, precise code changes, reviews, and multi-step debugging, prefer a higher-tier connected model from action="models" such as gpt-5.5, Claude Opus 4.7, or another Opus-class model when available, and pass a high reasoning variant such as variant="high" or variant="xhigh"/"max" if the returned model lists that variant.
- (!important!) For labor-intensive but well-defined work where the steps are already clear, prefer lower-tier connected models from action="models" such as gpt-5-mini, Claude Sonnet, or Claude Haiku when available; use lower/default reasoning unless the task unexpectedly requires deeper judgment.
- (!important!) Child sessions attach to the current parent OpenCode session. By default they run in the parent's resolved baseDirectory; pass baseDirectory only when the child should run in a different working directory while still staying attached to the same parent session.
- (!important!) For cross-agent coordination (pausing work, requesting a wait, signalling handoff, sharing intermediate findings, reporting progress, or notifying completion outside of the normal completion-notification path) use the companion tool \`message_background_subagent\`. Do NOT spawn an extra subagent just to deliver a message, and do NOT rely on polling \`status\`/\`output\` when an explicit message is more appropriate.
- (!important!) \`message_background_subagent\` is bidirectional. Parent → child: pass \`direction="to_subagent"\` and either \`backgroundId\` (returned from \`start\`) or \`targetSessionId\`. Child → parent: pass \`direction="to_parent"\` plus its own \`openCodeSessionId\`; the message is injected into the parent session. Sibling → sibling: pass \`targetSessionId\` of the peer (no automatic sibling discovery — the parent must hand peer session ids to children in their spawn prompts when sibling coordination is required).
- (!important!) Parent agents can also use action="message" with id plus message to send a no-reply status-check or coordination note to a tracked running child before starting overlapping work. This is a convenience wrapper around the same no-reply message envelope used by \`message_background_subagent\`; use the companion tool directly for child→parent or sibling messages.
- (!important!) When you start a background subagent that may need to coordinate, include in its initial prompt the peer/parent session ids it will be allowed to talk to, plus an instruction to use \`message_background_subagent\` for those specific coordination events.
</importantNotes>

<actions>
- "start": Create a child session and launch the prompt asynchronously. Requires prompt. Optional title, agent, providerId, modelId, variant, preset, and baseDirectory.
- "models": List connected provider/model pairs, recommendations, and suggested variants that are valid for start providerId/modelId.
- "list": List background subagents started through this MCP server process.
- "status": Refresh one background subagent's status. Requires id.
- "message": Send a no-reply status-check/coordination message to one tracked background subagent. Requires id and message. Optional reason.
- "wait": Wait for one background subagent's OpenCode session to become idle, then refresh and return its record. Requires id.
- "output": Return current assistant output for one background subagent. Requires id.
- "cancel": Abort a running background subagent. Requires id.
</actions>`;

function cacheRecord(
  record: BackgroundSubagentRecord,
): BackgroundSubagentRecord {
  backgroundSubagents.set(record.id, record);
  backgroundSubagentsBySessionId.set(record.sessionId, record);
  knownBackgroundSubagentSessionIds.add(record.sessionId);
  return record;
}

function persistRecord(record: BackgroundSubagentRecord): void {
  cacheRecord(record);
  upsertBackgroundSubagent(record);
}

function getRecordById(id: string): BackgroundSubagentRecord | null {
  return backgroundSubagents.get(id) ?? getBackgroundSubagentRecord(id);
}

function getRecordBySessionId(
  sessionId: string,
): BackgroundSubagentRecord | null {
  const cached = backgroundSubagentsBySessionId.get(sessionId);
  if (cached) return cached;
  if (!knownBackgroundSubagentSessionIds.has(sessionId)) return null;
  const record = getBackgroundSubagentRecordBySessionId(sessionId);
  return record ? cacheRecord(record) : null;
}

function jsonResult(payload: unknown): CallToolResult {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  };
}

function jsonError(error: string, message: string): CallToolResult {
  return {
    isError: true,
    content: [
      { type: 'text' as const, text: JSON.stringify({ error, message }) },
    ],
  };
}

function nextBackgroundSubagentId(): string {
  return `bg_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildBackgroundSubagentPromptBody(input: {
  prompt: string;
  agent?: string;
  model?: { providerID: string; modelID: string };
  variant?: string;
}): SessionPromptBody {
  const body: SessionPromptBody = {
    parts: [{ type: 'text', text: input.prompt }],
  };
  const agent = input.agent?.trim();
  if (agent) body.agent = agent;
  if (input.model) body.model = input.model;
  const variant = toProviderReasoningVariant(input.variant);
  if (variant) body.variant = variant;
  return body;
}

export function buildBackgroundSubagentModel(input: {
  providerId?: string;
  modelId?: string;
}): SessionCreateBody['model'] | undefined {
  const providerID = input.providerId?.trim();
  const id = input.modelId?.trim();
  if (!providerID || !id) return undefined;
  return { providerID, id };
}

export function buildBackgroundSubagentPromptModel(input: {
  providerId?: string;
  modelId?: string;
}): SessionPromptBody['model'] | undefined {
  const providerID = input.providerId?.trim();
  const modelID = input.modelId?.trim();
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
}

export function buildConnectedBackgroundSubagentModels(
  info: ProvidersInfo,
): ConnectedBackgroundSubagentModels & {
  recommendations: ModelRecommendation[];
} {
  const connected = new Set(info.connectedProviderIds);
  const providers = info.providers.filter((provider) =>
    connected.has(provider.id),
  );
  return {
    providers,
    connectedProviderIds: info.connectedProviderIds,
    defaults: info.defaults,
    recommendations: providers.flatMap(buildModelRecommendations),
  };
}

export function buildModelRecommendations(
  provider: ProvidersInfo['providers'][number],
): ModelRecommendation[] {
  return provider.models.map((model) => {
    const text =
      `${provider.id} ${provider.name} ${model.id} ${model.name}`.toLowerCase();
    const isLowTier = /mini|haiku/.test(text);
    const isMidLabor = /sonnet/.test(text) && !/opus/.test(text);
    const recommendedFor: ModelRecommendation['recommendedFor'] =
      isLowTier || isMidLabor
        ? ['predefined-labor', 'fast-check']
        : ['deep-reasoning', 'precise-review'];
    const suggestedVariant = recommendedFor.includes('deep-reasoning')
      ? model.variants?.find((variant) =>
          ['xhigh', 'max', 'high'].includes(variant),
        )
      : undefined;
    return {
      providerId: provider.id,
      modelId: model.id,
      recommendedFor,
      suggestedVariant,
    };
  });
}

export function resolvePresetModelSelection(
  preset: BackgroundSubagentPreset | undefined,
  connectedModels:
    | (ConnectedBackgroundSubagentModels & {
        recommendations?: ModelRecommendation[];
      })
    | null
    | undefined,
): { providerId: string; modelId: string; variant?: string } | null {
  if (!preset || !connectedModels) return null;
  const recommendations =
    connectedModels.recommendations ??
    connectedModels.providers.flatMap(buildModelRecommendations);
  const target =
    preset === 'deep'
      ? 'deep-reasoning'
      : preset === 'labor'
        ? 'predefined-labor'
        : 'fast-check';
  const match = recommendations.find((recommendation) =>
    recommendation.recommendedFor.includes(target),
  );
  if (!match) return null;
  return {
    providerId: match.providerId,
    modelId: match.modelId,
    variant: match.suggestedVariant,
  };
}

export function validateBackgroundSubagentModelSelection(
  input: { providerId?: string; modelId?: string },
  connectedModels: ConnectedBackgroundSubagentModels,
): { ok: true } | { ok: false; error: string } {
  const providerId = input.providerId?.trim();
  const modelId = input.modelId?.trim();
  if (!providerId && !modelId) return { ok: true };
  if (!providerId || !modelId) {
    return { ok: false, error: INVALID_MODEL_SELECTION_MESSAGE };
  }
  const provider = connectedModels.providers.find(
    (candidate) => candidate.id === providerId,
  );
  if (!provider?.models.some((model) => model.id === modelId)) {
    return { ok: false, error: INVALID_MODEL_SELECTION_MESSAGE };
  }
  return { ok: true };
}

export function resolveBackgroundSubagentBaseDirectory(input: {
  requestedBaseDirectory?: string | null;
  parentSessionDirectory?: string | null;
  registeredBaseDirectory?: string | null;
}): string | null {
  const requestedBaseDirectory = input.requestedBaseDirectory?.trim();
  if (requestedBaseDirectory) return requestedBaseDirectory;
  const parentDirectory = input.parentSessionDirectory?.trim();
  if (parentDirectory) return parentDirectory;
  const registeredBaseDirectory = input.registeredBaseDirectory?.trim();
  return registeredBaseDirectory || null;
}

export function resolveBackgroundSubagentParentSession(input: {
  explicitSessionId?: string | null;
}): BackgroundSubagentParentSelection {
  const explicitSessionId = input.explicitSessionId?.trim();
  if (explicitSessionId) {
    return {
      ok: true,
      parentSessionId: explicitSessionId,
      reason: 'explicit',
    };
  }

  return {
    ok: false,
    error:
      'Pass openCodeSessionId so the background subagent can be attached as a child of the current OpenCode session.',
  };
}

export function summarizeBackgroundSubagentStatus(input: {
  localStatus: BackgroundSubagentState;
  liveStatus?: LiveStatus;
}): BackgroundSubagentState {
  if (input.localStatus === 'cancelled' || input.localStatus === 'error') {
    return input.localStatus;
  }
  if (input.liveStatus === 'error') return 'error';
  if (input.liveStatus === 'idle') return 'completed';
  if (input.liveStatus === 'busy') return 'running';
  return input.localStatus;
}

export function seedKnownBackgroundSubagentSessions(
  records: readonly Pick<BackgroundSubagentRecord, 'sessionId'>[],
): void {
  for (const record of records) {
    knownBackgroundSubagentSessionIds.add(record.sessionId);
  }
}

function ensureKnownBackgroundSubagentSessionsLoaded(): void {
  if (knownBackgroundSubagentSessionsLoaded) return;
  knownBackgroundSubagentSessionsLoaded = true;
  seedKnownBackgroundSubagentSessions(listBackgroundSubagentRecords());
}

export function getLiveStatusFromMap(
  data: LiveStatusMap | null | undefined,
  sessionId: string,
): LiveStatus | undefined {
  const raw = data?.[sessionId]?.type;
  if (raw === 'busy' || raw === 'idle' || raw === 'error') return raw;
  return raw ? 'unknown' : undefined;
}

export function extractAssistantTextFromMessages(messages: unknown[]): string {
  const chunks: string[] = [];
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const info: object =
      'info' in message && message.info && typeof message.info === 'object'
        ? message.info
        : message;
    const role = 'role' in info ? info.role : undefined;
    if (role !== 'assistant') continue;
    const parts = 'parts' in message ? message.parts : undefined;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (!part || typeof part !== 'object') continue;
      const type = 'type' in part ? part.type : undefined;
      const text = 'text' in part ? part.text : undefined;
      if (type === 'text' && typeof text === 'string' && text.trim()) {
        chunks.push(text.trim());
      }
    }
  }
  return chunks.join('\n\n');
}

export function buildBackgroundSubagentCompletionMessage(input: {
  record: Pick<
    BackgroundSubagentRecord,
    'id' | 'sessionId' | 'title' | 'status' | 'error'
  >;
  output: string;
}): string {
  const lines = [
    '<background-subagent-completed>',
    `Background subagent "${input.record.title}" has finished.`,
    `- Background id: ${input.record.id}`,
    `- Session id: ${input.record.sessionId}`,
    `- Status: ${input.record.status}`,
  ];
  if (input.record.error) lines.push(`- Error: ${input.record.error}`);
  const output = input.output.trim();
  if (output) lines.push('', '<output>', output, '</output>');
  lines.push('</background-subagent-completed>');
  return lines.join('\n');
}

export function buildBackgroundSubagentCompletionInjection(input: {
  parentSessionId: string;
  record: Pick<
    BackgroundSubagentRecord,
    'id' | 'sessionId' | 'title' | 'status' | 'error'
  >;
  output: string;
}): { sessionId: string; message: string; noReply: false } {
  return {
    sessionId: input.parentSessionId,
    message: buildBackgroundSubagentCompletionMessage({
      record: input.record,
      output: input.output,
    }),
    noReply: false,
  };
}

export function buildBackgroundSubagentCoordinationMessage(input: {
  record: Pick<BackgroundSubagentRecord, 'sessionId' | 'parentSessionId'>;
  message: string;
  reason?: string;
}): { sessionId: string; message: string; noReply: true } {
  return {
    sessionId: input.record.sessionId,
    message: buildBackgroundSubagentMessage({
      direction: 'to_subagent',
      fromSessionId: input.record.parentSessionId,
      toSessionId: input.record.sessionId,
      message: input.message,
      reason: input.reason,
    }),
    noReply: true,
  };
}

async function getLiveStatus(
  openCodePort: number,
  sessionId: string,
  baseDirectory: string | null,
): Promise<LiveStatus | undefined> {
  const response = await sessionStatus(openCodePort, {
    directory: baseDirectory ?? undefined,
    signal: AbortSignal.timeout(3000),
  });
  if (response.error) return undefined;
  const data = response.data;
  if (!data || typeof data !== 'object') return undefined;
  return getLiveStatusFromMap(data as LiveStatusMap, sessionId);
}

async function fetchLiveStatusMap(
  openCodePort: number,
): Promise<LiveStatusMap | null> {
  const response = await sessionStatus(openCodePort, {
    signal: AbortSignal.timeout(3000),
  });
  if (response.error) return null;
  const data = response.data;
  return data && typeof data === 'object' ? (data as LiveStatusMap) : null;
}

async function getParentSessionDirectory(
  openCodePort: number,
  parentSessionId: string,
  registeredBaseDirectory: string | null,
): Promise<string | null> {
  const response = await sessionGet(openCodePort, parentSessionId, {
    directory: registeredBaseDirectory ?? undefined,
    signal: AbortSignal.timeout(3000),
  });
  if (response.error) return null;
  const data = response.data;
  if (!data || typeof data !== 'object') return null;
  const directory = 'directory' in data ? data.directory : undefined;
  return typeof directory === 'string' && directory.trim()
    ? directory.trim()
    : null;
}

export function serializeBackgroundSubagentRecord(
  record: BackgroundSubagentRecord,
  nowIso = new Date().toISOString(),
) {
  const started = Date.parse(record.startedAt);
  const updated = Date.parse(record.updatedAt);
  const now = Date.parse(nowIso);
  const elapsedMs =
    Number.isFinite(started) && Number.isFinite(now)
      ? Math.max(0, now - started)
      : 0;
  const idleMs =
    Number.isFinite(updated) && Number.isFinite(now)
      ? Math.max(0, now - updated)
      : 0;
  return {
    id: record.id,
    sessionId: record.sessionId,
    parentSessionId: record.parentSessionId,
    title: record.title,
    agent: record.agent,
    model: record.model,
    baseDirectory: record.baseDirectory,
    status: record.status,
    error: record.error,
    completionNotifiedAt: record.completionNotifiedAt,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    elapsedMs,
    idleMs,
    isPossiblyStalled:
      record.status === 'running' && idleMs >= STALLED_AFTER_MS,
  };
}

export function getBackgroundSubagentById(
  id: string,
): Pick<
  BackgroundSubagentRecord,
  'id' | 'sessionId' | 'parentSessionId' | 'title' | 'status'
> | null {
  const record = getRecordById(id);
  if (!record) return null;
  cacheRecord(record);
  return {
    id: record.id,
    sessionId: record.sessionId,
    parentSessionId: record.parentSessionId,
    title: record.title,
    status: record.status,
  };
}

async function refreshRecordStatus(
  record: BackgroundSubagentRecord,
  openCodePort: number,
  liveStatusMap?: LiveStatusMap | null,
): Promise<BackgroundSubagentRecord> {
  const liveStatus = liveStatusMap
    ? getLiveStatusFromMap(liveStatusMap, record.sessionId)
    : await getLiveStatus(openCodePort, record.sessionId, record.baseDirectory);
  const nextStatus = summarizeBackgroundSubagentStatus({
    localStatus: record.status,
    liveStatus,
  });
  if (nextStatus !== record.status) {
    record.status = nextStatus;
    record.updatedAt = new Date().toISOString();
    persistRecord(record);
  }
  return record;
}

async function readBackgroundSubagentOutput(
  record: BackgroundSubagentRecord,
  openCodePort: number,
): Promise<string> {
  const response = await sessionMessages(
    openCodePort,
    record.sessionId,
    { limit: 100 },
    {
      directory: record.baseDirectory ?? undefined,
      signal: AbortSignal.timeout(5000),
    },
  );
  if (response.error) {
    throw new Error(
      `Failed to read background subagent messages: ${JSON.stringify(response.error)}`,
    );
  }
  const messages = Array.isArray(response.data) ? response.data : [];
  return extractAssistantTextFromMessages(messages);
}

async function notifyParentOfCompletion(
  record: BackgroundSubagentRecord,
  openCodePort: number,
): Promise<void> {
  if (record.completionNotifiedAt) return;
  const output = await readBackgroundSubagentOutput(record, openCodePort);
  const injection = buildBackgroundSubagentCompletionInjection({
    parentSessionId: record.parentSessionId,
    record,
    output,
  });
  const result = await injectOpenCodeMessage(
    injection.sessionId,
    injection.message,
    undefined,
    openCodePort,
    undefined,
    injection.noReply,
  );
  if (!result.ok) throw new Error(result.error ?? 'Failed to notify parent.');
  record.completionNotifiedAt = new Date().toISOString();
  record.updatedAt = record.completionNotifiedAt;
  persistRecord(record);
}

export function hasTrackedBackgroundSubagentSession(
  sessionId: string,
): boolean {
  ensureKnownBackgroundSubagentSessionsLoaded();
  return getRecordBySessionId(sessionId) !== null;
}

export async function handleBackgroundSubagentSessionStatus(input: {
  openCodePort: number;
  sessionId: string;
  status: 'busy' | 'idle' | 'error' | 'unknown';
}): Promise<void> {
  ensureKnownBackgroundSubagentSessionsLoaded();
  if (!knownBackgroundSubagentSessionIds.has(input.sessionId)) return;
  const record = getRecordBySessionId(input.sessionId);
  if (!record) return;
  cacheRecord(record);
  const nextStatus = summarizeBackgroundSubagentStatus({
    localStatus: record.status,
    liveStatus: input.status,
  });
  if (nextStatus !== record.status) {
    record.status = nextStatus;
    record.updatedAt = new Date().toISOString();
    persistRecord(record);
  }
  if (record.status === 'completed' || record.status === 'error') {
    await notifyParentOfCompletion(record, input.openCodePort);
  }
}

export function registerManageBackgroundSubagentsTool(
  server: McpServer,
  _connectionId: string,
): void {
  void _connectionId;
  server.registerTool(
    'manage_background_subagents',
    {
      title: 'Manage background subagents',
      description: TOOL_DESCRIPTION,
      inputSchema: {
        action: z.enum([
          'start',
          'models',
          'list',
          'status',
          'message',
          'wait',
          'output',
          'cancel',
        ]),
        id: z.string().optional().describe('Background id returned by start.'),
        prompt: z
          .string()
          .optional()
          .describe('Prompt for the child subagent.'),
        message: z
          .string()
          .optional()
          .describe(
            'No-reply status-check/coordination message for action="message".',
          ),
        reason: z
          .string()
          .optional()
          .describe('Optional short coordination reason for action="message".'),
        title: z.string().optional().describe('Optional child session title.'),
        agent: z
          .string()
          .optional()
          .describe('Optional OpenCode agent name for the child session.'),
        providerId: z
          .string()
          .optional()
          .describe(
            'Optional OpenCode provider id. Must be paired with modelId.',
          ),
        modelId: z
          .string()
          .optional()
          .describe(
            'Optional OpenCode model id. Must be paired with providerId.',
          ),
        variant: z
          .string()
          .optional()
          .describe('Optional reasoning effort/variant for the model.'),
        preset: z
          .enum(['deep', 'labor', 'fast'])
          .optional()
          .describe(
            'Optional model selection preset. Use deep for high-reasoning work, labor for predefined work, fast for quick checks.',
          ),
        baseDirectory: z
          .string()
          .optional()
          .describe(
            'Optional child working directory. Does not affect parent session selection.',
          ),
        openCodeSessionId: z
          .string()
          .min(1)
          .describe('Current/root OpenCode session id used as parent.'),
      },
    },
    async ({
      action,
      id,
      prompt,
      message,
      reason,
      title,
      agent,
      providerId,
      modelId,
      variant,
      preset,
      baseDirectory: requestedBaseDirectory,
      openCodeSessionId,
    }): Promise<CallToolResult> => {
      const parentSelection = resolveBackgroundSubagentParentSession({
        explicitSessionId: openCodeSessionId,
      });
      if (!parentSelection.ok) {
        return jsonError('MISSING_SESSION_ID', parentSelection.error);
      }
      const parentSessionId = parentSelection.parentSessionId;
      const staleErr = staleSessionError(parentSessionId);
      if (staleErr) return staleErr;

      const openCodePort = getOpenCodePort();
      if (openCodePort === null) {
        return jsonError(
          'OPENCODE_UNAVAILABLE',
          'OpenCode port is unavailable.',
        );
      }

      switch (action) {
        case 'models': {
          const providersInfo = await fetchProvidersInfo(openCodePort);
          if (!providersInfo) {
            return jsonError(
              'MODEL_DISCOVERY_FAILED',
              'Could not fetch connected provider models.',
            );
          }
          return jsonResult({
            ok: true,
            action: 'models',
            ...buildConnectedBackgroundSubagentModels(providersInfo),
          });
        }

        case 'start': {
          if (!prompt || !prompt.trim()) {
            return jsonError(
              'MISSING_PROMPT',
              'The "start" action requires a non-empty prompt.',
            );
          }
          const parent =
            await getRegisteredConnectionBySessionId(parentSessionId);
          const registeredBaseDirectory = parent?.baseDirectory ?? null;
          const parentSessionDirectory = await getParentSessionDirectory(
            openCodePort,
            parentSessionId,
            registeredBaseDirectory,
          );
          const baseDirectory = resolveBackgroundSubagentBaseDirectory({
            requestedBaseDirectory,
            parentSessionDirectory,
            registeredBaseDirectory,
          });
          if (!baseDirectory) {
            return jsonError(
              'MISSING_BASE_DIRECTORY',
              'The parent session has no registered baseDirectory, so the background subagent cannot safely inherit the current working directory.',
            );
          }
          const providersInfo = await fetchProvidersInfo(openCodePort);
          const connectedModels = providersInfo
            ? buildConnectedBackgroundSubagentModels(providersInfo)
            : null;
          if ((providerId?.trim() || modelId?.trim()) && !connectedModels) {
            return jsonError(
              'MODEL_DISCOVERY_FAILED',
              'Could not fetch connected provider models. Try action="models" first, or omit providerId/modelId to use OpenCode defaults.',
            );
          }
          const presetSelection = resolvePresetModelSelection(
            preset,
            connectedModels ?? undefined,
          );
          const selectedProviderId = providerId ?? presetSelection?.providerId;
          const selectedModelId = modelId ?? presetSelection?.modelId;
          const selectedVariant = variant ?? presetSelection?.variant;
          if (connectedModels) {
            const validation = validateBackgroundSubagentModelSelection(
              { providerId: selectedProviderId, modelId: selectedModelId },
              connectedModels,
            );
            if (!validation.ok) {
              return jsonError('INVALID_MODEL_SELECTION', validation.error);
            }
          }
          const createModel = buildBackgroundSubagentModel({
            providerId: selectedProviderId,
            modelId: selectedModelId,
          });
          const createVariant = toProviderReasoningVariant(selectedVariant);
          const promptModel = buildBackgroundSubagentPromptModel({
            providerId: selectedProviderId,
            modelId: selectedModelId,
          });
          const childTitle =
            title?.trim() || `Background subagent: ${prompt.slice(0, 48)}`;
          const createResponse = await sessionCreate(
            openCodePort,
            {
              title: childTitle,
              parentID: parentSessionId,
              agent: agent?.trim() || undefined,
              model:
                createModel && createVariant
                  ? { ...createModel, variant: createVariant }
                  : createModel,
            },
            {
              directory: baseDirectory,
              signal: AbortSignal.timeout(10_000),
            },
          );
          if (createResponse.error) {
            return jsonError(
              'CREATE_FAILED',
              `Failed to create background subagent session: ${JSON.stringify(createResponse.error)}`,
            );
          }
          const session = createResponse.data as { id?: string } | undefined;
          if (!session?.id) {
            return jsonError(
              'CREATE_FAILED',
              'OpenCode did not return a child session id.',
            );
          }

          await upsertRegisteredConnection({
            providerType: 'opencode',
            providerSessionId: session.id,
            connectionId: null,
            channelName: childTitle,
            projectName: parent?.projectName ?? 'Background Subagent',
            baseDirectory,
            parentSessionId,
          });
          invalidateSessionTree();

          const bgId = nextBackgroundSubagentId();
          const now = new Date().toISOString();
          const record: BackgroundSubagentRecord = {
            id: bgId,
            sessionId: session.id,
            parentSessionId,
            prompt,
            title: childTitle,
            agent: agent?.trim() || null,
            model: promptModel
              ? {
                  ...promptModel,
                  variant: toProviderReasoningVariant(selectedVariant),
                }
              : null,
            baseDirectory,
            status: 'running',
            error: null,
            completionNotifiedAt: null,
            startedAt: now,
            updatedAt: now,
          };
          persistRecord(record);

          void sessionPromptAsync(
            openCodePort,
            session.id,
            buildBackgroundSubagentPromptBody({
              prompt,
              agent,
              model: promptModel,
              variant: selectedVariant,
            }),
            {
              directory: baseDirectory,
              signal: AbortSignal.timeout(10_000),
            },
          )
            .then((response) => {
              if (response.error) {
                record.status = 'error';
                record.error = JSON.stringify(response.error);
                record.updatedAt = new Date().toISOString();
                persistRecord(record);
                void notifyParentOfCompletion(record, openCodePort).catch(
                  () => undefined,
                );
              }
            })
            .catch((error: unknown) => {
              record.status = 'error';
              record.error =
                error instanceof Error ? error.message : String(error);
              record.updatedAt = new Date().toISOString();
              persistRecord(record);
              void notifyParentOfCompletion(record, openCodePort).catch(
                () => undefined,
              );
            });

          return jsonResult({
            ok: true,
            action: 'start',
            backgroundSubagent: serializeBackgroundSubagentRecord(record),
          });
        }

        case 'list': {
          const persistedRecords = listBackgroundSubagentRecords();
          seedKnownBackgroundSubagentSessions(persistedRecords);
          const liveStatusMap = await fetchLiveStatusMap(openCodePort);
          const records = await Promise.all(
            persistedRecords.map((record) =>
              refreshRecordStatus(record, openCodePort, liveStatusMap),
            ),
          );
          return jsonResult({
            ok: true,
            action: 'list',
            count: records.length,
            backgroundSubagents: records.map((record) =>
              serializeBackgroundSubagentRecord(record),
            ),
          });
        }

        case 'status': {
          if (!id)
            return jsonError('MISSING_ID', 'The "status" action requires id.');
          const record = getRecordById(id);
          if (!record)
            return jsonError(
              'NOT_FOUND',
              `No background subagent found for id ${id}.`,
            );
          await refreshRecordStatus(record, openCodePort);
          return jsonResult({
            ok: true,
            action: 'status',
            backgroundSubagent: serializeBackgroundSubagentRecord(record),
          });
        }

        case 'message': {
          if (!id)
            return jsonError('MISSING_ID', 'The "message" action requires id.');
          if (!message || !message.trim()) {
            return jsonError(
              'MISSING_MESSAGE',
              'The "message" action requires a non-empty message.',
            );
          }
          const record = getRecordById(id);
          if (!record)
            return jsonError(
              'NOT_FOUND',
              `No background subagent found for id ${id}.`,
            );
          await refreshRecordStatus(record, openCodePort);
          const injection = buildBackgroundSubagentCoordinationMessage({
            record,
            message,
            reason,
          });
          const injected = await injectOpenCodeMessage(
            injection.sessionId,
            injection.message,
            undefined,
            openCodePort,
            undefined,
            injection.noReply,
          );
          if (!injected.ok) {
            return jsonError(
              'INJECT_FAILED',
              injected.error ?? 'Failed to inject message into target session.',
            );
          }
          return jsonResult({
            ok: true,
            action: 'message',
            backgroundSubagent: serializeBackgroundSubagentRecord(record),
            toSessionId: record.sessionId,
            noReply: true,
          });
        }

        case 'wait': {
          if (!id)
            return jsonError('MISSING_ID', 'The "wait" action requires id.');
          const record = getRecordById(id);
          if (!record)
            return jsonError(
              'NOT_FOUND',
              `No background subagent found for id ${id}.`,
            );
          if (record.status === 'running') {
            let response: Awaited<ReturnType<typeof sessionWait>>;
            try {
              response = await sessionWait(openCodePort, record.sessionId, {
                directory: record.baseDirectory ?? undefined,
              });
            } catch (error) {
              return jsonError(
                'WAIT_FAILED',
                error instanceof Error ? error.message : String(error),
              );
            }
            if (response.error) {
              return jsonError(
                'WAIT_FAILED',
                `Failed to wait for background subagent session: ${JSON.stringify(response.error)}`,
              );
            }
            record.status = 'completed';
            record.updatedAt = new Date().toISOString();
            persistRecord(record);
            await notifyParentOfCompletion(record, openCodePort);
          } else {
            await refreshRecordStatus(record, openCodePort);
          }
          return jsonResult({
            ok: true,
            action: 'wait',
            backgroundSubagent: serializeBackgroundSubagentRecord(record),
          });
        }

        case 'output': {
          if (!id)
            return jsonError('MISSING_ID', 'The "output" action requires id.');
          const record = getRecordById(id);
          if (!record)
            return jsonError(
              'NOT_FOUND',
              `No background subagent found for id ${id}.`,
            );
          await refreshRecordStatus(record, openCodePort);
          let output: string;
          try {
            output = await readBackgroundSubagentOutput(record, openCodePort);
          } catch (error) {
            return jsonError(
              'OUTPUT_FAILED',
              error instanceof Error ? error.message : String(error),
            );
          }
          return jsonResult({
            ok: true,
            action: 'output',
            backgroundSubagent: serializeBackgroundSubagentRecord(record),
            output,
          });
        }

        case 'cancel': {
          if (!id)
            return jsonError('MISSING_ID', 'The "cancel" action requires id.');
          const record = getRecordById(id);
          if (!record)
            return jsonError(
              'NOT_FOUND',
              `No background subagent found for id ${id}.`,
            );
          const aborted = await abortOpenCodeSession(
            openCodePort,
            record.sessionId,
          );
          if (aborted) {
            record.status = 'cancelled';
            record.updatedAt = new Date().toISOString();
            persistRecord(record);
          }
          return jsonResult({
            ok: aborted,
            action: 'cancel',
            backgroundSubagent: serializeBackgroundSubagentRecord(record),
          });
        }
      }
    },
  );
}
