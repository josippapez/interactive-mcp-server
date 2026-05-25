/**
 * Main-side proxy client for the OpenCode SDK layer that now lives in the
 * utility process (Phase 4a of the backend extraction).
 *
 * Each function dispatches a bridge.request to the utility. All methods are
 * async. Utility-local callers MUST NOT import this file — they import the
 * backend modules directly (siblings under `utility/backend/`).
 */

import type { Bridge } from './bridge';
import { getUtilitySupervisor } from './supervisor';

// Re-export the public types so main-side consumers don't need to reach into
// `utility/backend/*` for type-only imports.
export type { Attachment, ModelOverride } from './backend/injector';
export type { PendingPermissionRecord } from './backend/permission-list';
export type {
  PendingQuestionRecord,
  PendingQuestionInfo,
  PendingQuestionOption,
} from './backend/question-list';
export type { Todo } from './backend/todo';
export type { VcsInfo } from './backend/vcs-api';
export type {
  SessionStatusMap,
  SessionStatusType,
} from './backend/session-status';
export type {
  DetectedSession,
  OpenCodeSession,
  CreateSessionResult,
  SessionAttachment,
  InitialPromptBody,
} from './backend/session';
export type {
  Provider,
  ProviderModel,
  ProvidersInfo,
  Model,
  AuthMethod,
  AuthPrompt,
  AuthorizeResult,
  ProviderActionResult,
} from './backend/provider';
export type {
  Command,
  CommandArg,
  CommandsResponse,
  ExecuteCommandResult,
} from './backend/command';
export type {
  McpRegistrationOptions,
  McpRegistrationResult,
  McpRetryOptions,
} from './backend/mcp-register';
export type {
  McpServerConfig,
  McpInjectionResult,
  McpInjectionSummary,
  McpInjectionOptions,
} from './backend/mcp-inject';
export type {
  McpServerStatus,
  McpTool,
  McpResource,
  McpPrompt,
  McpStatusResult,
  McpOperationResult,
  McpAuthStartResult,
  McpAuthStatusResult,
} from './backend/mcp-status';
export type { ReadConfigResult, WriteConfigResult } from './backend/config-io';
export type { AgentDefinition, WriteAgentParams } from './backend/agents';
export type { OpenCodeSdkStatus } from './backend/sdk-status';
export type {
  OpenCodeFileNode,
  OpenCodeFindFilesOptions,
  OpenCodeListFilesOptions,
  OpenCodeUtilitySnapshot,
} from './backend/sdk-utility';
export { SUPPORTED_FILE_EXTENSIONS } from './backend/injector';

function bridge(): Bridge {
  return getUtilitySupervisor().getBridge();
}

function call<T>(
  name: string,
  args: unknown[],
  opts?: { timeoutMs?: number },
): Promise<T> {
  return bridge().request<T>(name, { args }, opts);
}

const MCP_OPERATION_BRIDGE_TIMEOUT_MS = 60_000;

// ─── session-api ────────────────────────────────────────────────────────────

import type {
  SessionListQuery,
  SessionApiOpts,
  SessionCreateBody,
  SessionUpdateBody,
  SessionMessagesQuery,
  SessionSummarizeBody,
  SessionForkBody,
  SessionDiffBody,
  SessionInitBody,
  SessionRevertBody,
  SessionPromptBody,
  SessionCommandBody,
  SessionShellBody,
} from './backend/session-api';

export type {
  SessionListQuery,
  SessionApiOpts,
  SessionCreateBody,
  SessionUpdateBody,
  SessionMessagesQuery,
  SessionSummarizeBody,
  SessionForkBody,
  SessionDiffBody,
  SessionInitBody,
  SessionRevertBody,
  SessionPromptBody,
  SessionCommandBody,
  SessionShellBody,
};

export function sessionList(
  port: number,
  query?: SessionListQuery,
  opts?: SessionApiOpts,
): Promise<unknown> {
  return call('opencode.sessionList', [port, query, opts]);
}

export function sessionStatus(
  port: number,
  opts?: SessionApiOpts,
): Promise<unknown> {
  return call('opencode.sessionStatus', [port, opts]);
}

export function sessionGet(
  port: number,
  id: string,
  opts?: SessionApiOpts,
): Promise<unknown> {
  return call('opencode.sessionGet', [port, id, opts]);
}

export function sessionTodo(
  port: number,
  id: string,
  opts?: SessionApiOpts,
): Promise<unknown> {
  return call('opencode.sessionTodo', [port, id, opts]);
}

export function sessionAbort(
  port: number,
  id: string,
  opts?: SessionApiOpts,
): Promise<unknown> {
  return call('opencode.sessionAbort', [port, id, opts]);
}

export function sessionMessages(
  port: number,
  id: string,
  query?: SessionMessagesQuery,
  opts?: SessionApiOpts,
): Promise<unknown> {
  return call('opencode.sessionMessages', [port, id, query, opts]);
}

export function sessionPromptAsync(
  port: number,
  id: string,
  body: SessionPromptBody,
  opts?: SessionApiOpts,
): Promise<unknown> {
  return call('opencode.sessionPromptAsync', [port, id, body, opts]);
}

export function sessionCommand(
  port: number,
  id: string,
  body: SessionCommandBody,
  opts?: SessionApiOpts,
): Promise<unknown> {
  return call('opencode.sessionCommand', [port, id, body, opts]);
}

// ─── session ────────────────────────────────────────────────────────────────

import type {
  OpenCodeSession,
  DetectedSession,
  CreateSessionResult,
} from './backend/session';

export function fetchAllOpenCodeSessions(
  openCodePort: number,
): Promise<OpenCodeSession[]> {
  return call('opencode.fetchAllOpenCodeSessions', [openCodePort]);
}

export function fetchSessionsForDirectory(
  openCodePort: number,
  directory: string,
): Promise<OpenCodeSession[]> {
  return call('opencode.fetchSessionsForDirectory', [openCodePort, directory]);
}

export function autoDetectOpenCodeSession(
  openCodePort: number,
  directory?: string,
): Promise<DetectedSession | null> {
  return call('opencode.autoDetectOpenCodeSession', [openCodePort, directory]);
}

export function autoDetectOpenCodeSessionId(
  openCodePort: number,
  directory?: string,
): Promise<string | null> {
  return call('opencode.autoDetectOpenCodeSessionId', [
    openCodePort,
    directory,
  ]);
}

export function fetchOpenCodeSession(
  openCodePort: number,
  sessionID: string,
  directory?: string,
): Promise<OpenCodeSession | null> {
  return call('opencode.fetchOpenCodeSession', [
    openCodePort,
    sessionID,
    directory,
  ]);
}

export function createOpenCodeSession(
  openCodePort: number,
  opts: unknown,
): Promise<CreateSessionResult> {
  return call('opencode.createOpenCodeSession', [openCodePort, opts]);
}

// ─── injector ───────────────────────────────────────────────────────────────

import type { Attachment, ModelOverride } from './backend/injector';

export function injectOpenCodeMessage(
  openCodeSessionId: string,
  message: string,
  attachments: Attachment[] | undefined,
  openCodePort: number,
  mcpServerPort?: number,
  noReply: boolean = true,
  modelOverride?: ModelOverride,
  systemMessage?: string,
  agent?: string,
): Promise<{ ok: boolean; error?: string; noReply?: boolean }> {
  return call('opencode.injectOpenCodeMessage', [
    openCodeSessionId,
    message,
    attachments,
    openCodePort,
    mcpServerPort,
    noReply,
    modelOverride,
    systemMessage,
    agent,
  ]);
}

// ─── abort ──────────────────────────────────────────────────────────────────

export function abortOpenCodeSession(
  openCodePort: number,
  sessionId: string,
): Promise<boolean> {
  return call('opencode.abortOpenCodeSession', [openCodePort, sessionId]);
}

// ─── question-list ──────────────────────────────────────────────────────────

import type { PendingQuestionRecord } from './backend/question-list';

export function fetchPendingQuestions(
  openCodePort: number,
): Promise<PendingQuestionRecord[]> {
  return call('opencode.fetchPendingQuestions', [openCodePort]);
}

export function replyToOpenCodeQuestion(
  openCodePort: number,
  requestID: string,
  answers: string[][],
  sessionID: string,
): Promise<{ ok: boolean; error?: string }> {
  return call('opencode.replyToOpenCodeQuestion', [
    openCodePort,
    requestID,
    answers,
    sessionID,
  ]);
}

export function rejectOpenCodeQuestion(
  openCodePort: number,
  requestID: string,
  sessionID: string,
): Promise<{ ok: boolean; error?: string }> {
  return call('opencode.rejectOpenCodeQuestion', [
    openCodePort,
    requestID,
    sessionID,
  ]);
}

export function rejectPendingQuestionsForSession(
  openCodePort: number,
  sessionID: string,
): Promise<string[]> {
  return call('opencode.rejectPendingQuestionsForSession', [
    openCodePort,
    sessionID,
  ]);
}

// ─── permission-list ────────────────────────────────────────────────────────

import type { PendingPermissionRecord } from './backend/permission-list';

export function fetchPendingPermissions(
  openCodePort: number,
  baseDirectory?: string,
): Promise<PendingPermissionRecord[]> {
  return call('opencode.fetchPendingPermissions', [
    openCodePort,
    baseDirectory,
  ]);
}

// ─── todo ───────────────────────────────────────────────────────────────────

import type { Todo } from './backend/todo';

export function fetchTodosForSession(
  openCodePort: number,
  sessionId: string,
): Promise<Todo[]> {
  return call('opencode.fetchTodosForSession', [openCodePort, sessionId]);
}

// ─── vcs-api ────────────────────────────────────────────────────────────────

import type { VcsInfo } from './backend/vcs-api';

export function fetchVcsInfo(
  openCodePort: number,
  baseDirectory?: string,
): Promise<VcsInfo | null> {
  return call('opencode.fetchVcsInfo', [openCodePort, baseDirectory]);
}

// ─── session-status ─────────────────────────────────────────────────────────

import type { SessionStatusMap } from './backend/session-status';

export function fetchSessionStatus(
  openCodePort: number,
): Promise<SessionStatusMap | null> {
  return call('opencode.fetchSessionStatus', [openCodePort]);
}

import type { OpenCodeSdkStatus } from './backend/sdk-status';

export function fetchOpenCodeSdkStatus(
  openCodePort: number,
  baseDirectory?: string,
): Promise<OpenCodeSdkStatus> {
  return call('opencode.fetchOpenCodeSdkStatus', [openCodePort, baseDirectory]);
}

import type {
  OpenCodeFileNode,
  OpenCodeFindFilesOptions,
  OpenCodeListFilesOptions,
  OpenCodeUtilitySnapshot,
} from './backend/sdk-utility';

export function fetchOpenCodeUtilitySnapshot(
  openCodePort: number,
  baseDirectory?: string,
): Promise<OpenCodeUtilitySnapshot> {
  return call('opencode.fetchOpenCodeUtilitySnapshot', [
    openCodePort,
    baseDirectory,
  ]);
}

export function findOpenCodeFiles(
  openCodePort: number,
  options: OpenCodeFindFilesOptions,
): Promise<string[]> {
  return call('opencode.findOpenCodeFiles', [openCodePort, options]);
}

export function listOpenCodeFiles(
  openCodePort: number,
  options: OpenCodeListFilesOptions,
): Promise<OpenCodeFileNode[]> {
  return call('opencode.listOpenCodeFiles', [openCodePort, options]);
}

// ─── provider ───────────────────────────────────────────────────────────────

import type {
  Provider,
  ProvidersInfo,
  Model,
  AuthMethod,
  ProviderActionResult,
  AuthorizeResult,
} from './backend/provider';

export function fetchProviders(
  openCodePort: number,
): Promise<Provider[] | null> {
  return call('opencode.fetchProviders', [openCodePort]);
}

export function fetchProvidersInfo(
  openCodePort: number,
): Promise<ProvidersInfo | null> {
  return call('opencode.fetchProvidersInfo', [openCodePort]);
}

export function refreshProvidersInfo(
  openCodePort: number,
): Promise<ProvidersInfo | null> {
  return call('opencode.refreshProvidersInfo', [openCodePort]);
}

export function fetchModels(openCodePort: number): Promise<Model[]> {
  return call('opencode.fetchModels', [openCodePort]);
}

export function clearProviderCache(): Promise<void> {
  return call('opencode.clearProviderCache', []);
}

export function fetchProviderAuthMethods(
  openCodePort: number,
): Promise<Record<string, AuthMethod[]> | null> {
  return call('opencode.fetchProviderAuthMethods', [openCodePort]);
}

export function authorizeProvider(
  openCodePort: number,
  providerId: string,
  method: number,
  inputs?: Record<string, string>,
): Promise<ProviderActionResult<AuthorizeResult>> {
  return call('opencode.authorizeProvider', [
    openCodePort,
    providerId,
    method,
    inputs,
  ]);
}

export function callbackProvider(
  openCodePort: number,
  providerId: string,
  method: number,
  code?: string,
): Promise<ProviderActionResult<true>> {
  return call('opencode.callbackProvider', [
    openCodePort,
    providerId,
    method,
    code,
  ]);
}

export function setProviderApiKey(
  openCodePort: number,
  providerId: string,
  apiKey: string,
): Promise<boolean> {
  return call('opencode.setProviderApiKey', [openCodePort, providerId, apiKey]);
}

// ─── command ────────────────────────────────────────────────────────────────

import type { Command, ExecuteCommandResult } from './backend/command';

export function fetchCommands(
  openCodePort: number,
  directory?: string,
): Promise<Command[] | null> {
  return call('opencode.fetchCommands', [openCodePort, directory]);
}

export function executeCommand(
  openCodePort: number,
  sessionId: string,
  commandName: string,
  args?: Record<string, string>,
  baseDirectory?: string,
): Promise<ExecuteCommandResult> {
  return call('opencode.executeCommand', [
    openCodePort,
    sessionId,
    commandName,
    args,
    baseDirectory,
  ]);
}

// ─── mcp-register ───────────────────────────────────────────────────────────

import type {
  McpRegistrationResult,
  McpRegistrationOptions,
  McpRetryOptions,
} from './backend/mcp-register';

export function registerMcpWithOpenCode(
  opts: McpRegistrationOptions,
): Promise<McpRegistrationResult> {
  return call('opencode.registerMcpWithOpenCode', [opts]);
}

export function registerMcpWithRetry(
  opts: McpRetryOptions,
): Promise<McpRegistrationResult> {
  return call('opencode.registerMcpWithRetry', [opts]);
}

export function registerMcpAcrossReachablePorts(
  opts: McpRegistrationOptions,
): Promise<McpRegistrationResult> {
  return call('opencode.registerMcpAcrossReachablePorts', [opts]);
}

// ─── mcp-inject ─────────────────────────────────────────────────────────────

import type {
  McpInjectionSummary,
  McpInjectionOptions,
} from './backend/mcp-inject';

export function injectProjectMcps(
  opts: McpInjectionOptions,
): Promise<McpInjectionSummary> {
  return call('opencode.injectProjectMcps', [opts]);
}

export function recordInjectedMcps(
  sessionId: string,
  mcpNames: string[],
): Promise<void> {
  return call('opencode.recordInjectedMcps', [sessionId, mcpNames]);
}

// ─── mcp-status ─────────────────────────────────────────────────────────────

import type {
  McpStatusResult,
  McpOperationResult,
  McpAuthStartResult,
  McpAuthStatusResult,
} from './backend/mcp-status';

export function fetchMcpStatus(
  openCodePort: number,
  directory?: string,
  options?: Parameters<typeof import('./backend/mcp-status').fetchMcpStatus>[2],
): Promise<McpStatusResult> {
  return call('opencode.fetchMcpStatus', [openCodePort, directory, options], {
    timeoutMs: 30_000,
  });
}

export function connectMcp(
  openCodePort: number,
  name: string,
  directory?: string,
): Promise<McpOperationResult> {
  return call('opencode.connectMcp', [openCodePort, name, directory], {
    timeoutMs: MCP_OPERATION_BRIDGE_TIMEOUT_MS,
  });
}

export function disconnectMcp(
  openCodePort: number,
  name: string,
  directory?: string,
): Promise<McpOperationResult> {
  return call('opencode.disconnectMcp', [openCodePort, name, directory], {
    timeoutMs: MCP_OPERATION_BRIDGE_TIMEOUT_MS,
  });
}

export function registerMcp(
  openCodePort: number,
  name: string,
  config: {
    type: 'local' | 'remote';
    url?: string;
    command?: string[];
    environment?: Record<string, string>;
    timeout?: number;
  },
  directory?: string,
): Promise<McpOperationResult> {
  return call('opencode.registerMcp', [openCodePort, name, config, directory]);
}

export function startMcpAuth(
  openCodePort: number,
  name: string,
  directory?: string,
): Promise<McpAuthStartResult> {
  return call('opencode.startMcpAuth', [openCodePort, name, directory]);
}

export function callbackMcpAuth(
  openCodePort: number,
  name: string,
  code: string,
  directory?: string,
): Promise<McpAuthStatusResult> {
  return call('opencode.callbackMcpAuth', [
    openCodePort,
    name,
    code,
    directory,
  ]);
}

export function authenticateMcp(
  openCodePort: number,
  name: string,
  directory?: string,
): Promise<McpAuthStatusResult> {
  return call('opencode.authenticateMcp', [openCodePort, name, directory]);
}

export function removeMcpAuth(
  openCodePort: number,
  name: string,
  directory?: string,
): Promise<McpOperationResult> {
  return call('opencode.removeMcpAuth', [openCodePort, name, directory]);
}

// ─── config-io ──────────────────────────────────────────────────────────────

import type { ReadConfigResult, WriteConfigResult } from './backend/config-io';
import type { OpenCodeConfigDefaults } from './backend/config-defaults';

export function readGlobalConfig(): Promise<ReadConfigResult> {
  return call('opencode.readGlobalConfig', []);
}

export function readProjectConfig(
  baseDirectory: string,
): Promise<ReadConfigResult> {
  return call('opencode.readProjectConfig', [baseDirectory]);
}

export function fetchOpenCodeConfigDefaults(
  openCodePort: number,
  baseDirectory?: string,
): Promise<OpenCodeConfigDefaults> {
  return call('opencode.fetchOpenCodeConfigDefaults', [
    openCodePort,
    baseDirectory,
  ]);
}

export function writeGlobalConfig(data: unknown): Promise<WriteConfigResult> {
  return call('opencode.writeGlobalConfig', [data]);
}

export function writeProjectConfig(
  baseDirectory: string,
  data: unknown,
): Promise<WriteConfigResult> {
  return call('opencode.writeProjectConfig', [baseDirectory, data]);
}

// ─── config-sync ────────────────────────────────────────────────────────────

export function syncRemoteConfig(
  appPort: number,
  promptTimeoutSeconds?: number,
): Promise<string> {
  return call('opencode.syncRemoteConfig', [appPort, promptTimeoutSeconds]);
}

// ─── agents ─────────────────────────────────────────────────────────────────

import type { AgentDefinition, WriteAgentParams } from './backend/agents';
import type { NativeOpenCodeSkill } from './backend/native-skills';

export function listAgents(
  openCodePort?: number,
  baseDirectory?: string,
): Promise<AgentDefinition[]> {
  return call('opencode.listAgents', [openCodePort, baseDirectory]);
}

export function readAgent(filePath: string): Promise<AgentDefinition | null> {
  return call('opencode.readAgent', [filePath]);
}

export function writeAgent(params: WriteAgentParams): Promise<AgentDefinition> {
  return call('opencode.writeAgent', [params]);
}

export function deleteAgent(filePath: string): Promise<void> {
  return call('opencode.deleteAgent', [filePath]);
}

export type { NativeOpenCodeSkill };

export function listNativeOpenCodeSkills(
  openCodePort: number,
  baseDirectory?: string,
): Promise<NativeOpenCodeSkill[]> {
  return call('opencode.listNativeOpenCodeSkills', [
    openCodePort,
    baseDirectory,
  ]);
}
