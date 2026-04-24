/**
 * Bridge RPC handlers for the OpenCode SDK layer.
 *
 * Registered once by `entry.ts`. Each handler dispatches to one utility-local
 * function; the main-side proxy lives in `utility/opencode-client.ts`.
 *
 * Args are received as a positional tuple via the `{ args: [...] }` envelope.
 */

import type { Bridge } from '../bridge';

import * as sessionApi from './session-api';
import * as session from './session';
import * as injectorMod from './injector';
import * as abortMod from './abort';
import * as questionList from './question-list';
import * as permissionList from './permission-list';
import * as todoMod from './todo';
import * as vcsApi from './vcs-api';
import * as sessionStatus from './session-status';
import * as providerMod from './provider';
import * as commandMod from './command';
import * as mcpRegister from './mcp-register';
import * as mcpInject from './mcp-inject';
import * as mcpStatus from './mcp-status';
import * as configIo from './config-io';
import * as configSync from './config-sync';
import * as agents from './agents';

interface ArgsEnvelope {
  args?: unknown[];
}

function argsOf(payload: unknown): unknown[] {
  return (payload as ArgsEnvelope | undefined)?.args ?? [];
}

export function registerOpencodeRpcHandlers(bridge: Bridge): void {
  // ── session-api ──────────────────────────────────────────────────────────
  bridge.handle('opencode.sessionList', (p) => {
    const [port, query, opts] = argsOf(p) as [
      number,
      sessionApi.SessionListQuery | undefined,
      sessionApi.SessionApiOpts | undefined,
    ];
    return sessionApi.sessionList(port, query, opts);
  });

  bridge.handle('opencode.sessionStatus', (p) => {
    const [port, opts] = argsOf(p) as [
      number,
      sessionApi.SessionApiOpts | undefined,
    ];
    return sessionApi.sessionStatus(port, opts);
  });

  bridge.handle('opencode.sessionGet', (p) => {
    const [port, id, opts] = argsOf(p) as [
      number,
      string,
      sessionApi.SessionApiOpts | undefined,
    ];
    return sessionApi.sessionGet(port, id, opts);
  });

  bridge.handle('opencode.sessionTodo', (p) => {
    const [port, id, opts] = argsOf(p) as [
      number,
      string,
      sessionApi.SessionApiOpts | undefined,
    ];
    return sessionApi.sessionTodo(port, id, opts);
  });

  bridge.handle('opencode.sessionAbort', (p) => {
    const [port, id, opts] = argsOf(p) as [
      number,
      string,
      sessionApi.SessionApiOpts | undefined,
    ];
    return sessionApi.sessionAbort(port, id, opts);
  });

  bridge.handle('opencode.sessionMessages', (p) => {
    const [port, id, query, opts] = argsOf(p) as [
      number,
      string,
      sessionApi.SessionMessagesQuery | undefined,
      sessionApi.SessionApiOpts | undefined,
    ];
    return sessionApi.sessionMessages(port, id, query, opts);
  });

  bridge.handle('opencode.sessionPromptAsync', (p) => {
    const [port, id, body, opts] = argsOf(p) as [
      number,
      string,
      sessionApi.SessionPromptBody,
      sessionApi.SessionApiOpts | undefined,
    ];
    return sessionApi.sessionPromptAsync(port, id, body, opts);
  });

  bridge.handle('opencode.sessionCommand', (p) => {
    const [port, id, body, opts] = argsOf(p) as [
      number,
      string,
      sessionApi.SessionCommandBody,
      sessionApi.SessionApiOpts | undefined,
    ];
    return sessionApi.sessionCommand(port, id, body, opts);
  });

  // ── session ──────────────────────────────────────────────────────────────
  bridge.handle('opencode.fetchAllOpenCodeSessions', (p) => {
    const [port] = argsOf(p) as [number];
    return session.fetchAllOpenCodeSessions(port);
  });

  bridge.handle('opencode.fetchSessionsForDirectory', (p) => {
    const [port, dir] = argsOf(p) as [number, string];
    return session.fetchSessionsForDirectory(port, dir);
  });

  bridge.handle('opencode.autoDetectOpenCodeSession', (p) => {
    const [port, dir] = argsOf(p) as [number, string | undefined];
    return session.autoDetectOpenCodeSession(port, dir);
  });

  bridge.handle('opencode.autoDetectOpenCodeSessionId', (p) => {
    const [port, dir] = argsOf(p) as [number, string | undefined];
    return session.autoDetectOpenCodeSessionId(port, dir);
  });

  bridge.handle('opencode.fetchOpenCodeSession', (p) => {
    const [port, id, dir] = argsOf(p) as [number, string, string | undefined];
    return session.fetchOpenCodeSession(port, id, dir);
  });

  bridge.handle('opencode.createOpenCodeSession', (p) => {
    const [port, opts] = argsOf(p) as [
      number,
      Parameters<typeof session.createOpenCodeSession>[1],
    ];
    return session.createOpenCodeSession(port, opts);
  });

  // ── injector ─────────────────────────────────────────────────────────────
  bridge.handle('opencode.injectOpenCodeMessage', (p) => {
    const [
      sessionId,
      message,
      attachments,
      port,
      mcpPort,
      noReply,
      modelOverride,
      systemMessage,
      agent,
    ] = argsOf(p) as [
      string,
      string,
      injectorMod.Attachment[] | undefined,
      number,
      number | undefined,
      boolean | undefined,
      injectorMod.ModelOverride | undefined,
      string | undefined,
      string | undefined,
    ];
    return injectorMod.injectOpenCodeMessage(
      sessionId,
      message,
      attachments,
      port,
      mcpPort,
      noReply ?? true,
      modelOverride,
      systemMessage,
      agent,
    );
  });

  // ── abort ────────────────────────────────────────────────────────────────
  bridge.handle('opencode.abortOpenCodeSession', (p) => {
    const [port, sessionId] = argsOf(p) as [number, string];
    return abortMod.abortOpenCodeSession(port, sessionId);
  });

  // ── question-list ────────────────────────────────────────────────────────
  bridge.handle('opencode.fetchPendingQuestions', (p) => {
    const [port] = argsOf(p) as [number];
    return questionList.fetchPendingQuestions(port);
  });

  bridge.handle('opencode.replyToOpenCodeQuestion', (p) => {
    const [port, requestID, answers, sessionID] = argsOf(p) as [
      number,
      string,
      string[][],
      string,
    ];
    return questionList.replyToOpenCodeQuestion(
      port,
      requestID,
      answers,
      sessionID,
    );
  });

  bridge.handle('opencode.rejectOpenCodeQuestion', (p) => {
    const [port, requestID, sessionID] = argsOf(p) as [number, string, string];
    return questionList.rejectOpenCodeQuestion(port, requestID, sessionID);
  });

  // ── permission-list ──────────────────────────────────────────────────────
  bridge.handle('opencode.fetchPendingPermissions', (p) => {
    const [port, baseDir] = argsOf(p) as [number, string | undefined];
    return permissionList.fetchPendingPermissions(port, baseDir);
  });

  // ── todo ─────────────────────────────────────────────────────────────────
  bridge.handle('opencode.fetchTodosForSession', (p) => {
    const [port, sessionId] = argsOf(p) as [number, string];
    return todoMod.fetchTodosForSession(port, sessionId);
  });

  // ── vcs-api ──────────────────────────────────────────────────────────────
  bridge.handle('opencode.fetchVcsInfo', (p) => {
    const [port, baseDirectory] = argsOf(p) as [number, string | undefined];
    return vcsApi.fetchVcsInfo(port, baseDirectory);
  });

  // ── session-status ───────────────────────────────────────────────────────
  bridge.handle('opencode.fetchSessionStatus', (p) => {
    const [port] = argsOf(p) as [number];
    return sessionStatus.fetchSessionStatus(port);
  });

  // ── provider ─────────────────────────────────────────────────────────────
  bridge.handle('opencode.fetchProviders', (p) => {
    const [port] = argsOf(p) as [number];
    return providerMod.fetchProviders(port);
  });

  bridge.handle('opencode.fetchProvidersInfo', (p) => {
    const [port] = argsOf(p) as [number];
    return providerMod.fetchProvidersInfo(port);
  });

  bridge.handle('opencode.refreshProvidersInfo', (p) => {
    const [port] = argsOf(p) as [number];
    return providerMod.refreshProvidersInfo(port);
  });

  bridge.handle('opencode.fetchModels', (p) => {
    const [port] = argsOf(p) as [number];
    return providerMod.fetchModels(port);
  });

  bridge.handle('opencode.clearProviderCache', () => {
    providerMod.clearProviderCache();
  });

  bridge.handle('opencode.fetchProviderAuthMethods', (p) => {
    const [port] = argsOf(p) as [number];
    return providerMod.fetchProviderAuthMethods(port);
  });

  bridge.handle('opencode.authorizeProvider', (p) => {
    const [port, providerId, method, inputs] = argsOf(p) as [
      number,
      string,
      number,
      Record<string, string> | undefined,
    ];
    return providerMod.authorizeProvider(port, providerId, method, inputs);
  });

  bridge.handle('opencode.callbackProvider', (p) => {
    const [port, providerId, method, code] = argsOf(p) as [
      number,
      string,
      number,
      string | undefined,
    ];
    return providerMod.callbackProvider(port, providerId, method, code);
  });

  bridge.handle('opencode.setProviderApiKey', (p) => {
    const [port, providerId, apiKey] = argsOf(p) as [number, string, string];
    return providerMod.setProviderApiKey(port, providerId, apiKey);
  });

  // ── command ──────────────────────────────────────────────────────────────
  bridge.handle('opencode.fetchCommands', (p) => {
    const [port, baseDirectory] = argsOf(p) as [number, string | undefined];
    return commandMod.fetchCommands(port, baseDirectory);
  });

  bridge.handle('opencode.executeCommand', (p) => {
    const [port, sessionId, name, cmdArgs, baseDirectory] = argsOf(p) as [
      number,
      string,
      string,
      Record<string, string> | undefined,
      string | undefined,
    ];
    return commandMod.executeCommand(
      port,
      sessionId,
      name,
      cmdArgs,
      baseDirectory,
    );
  });

  // ── mcp-register ─────────────────────────────────────────────────────────
  bridge.handle('opencode.registerMcpWithOpenCode', (p) => {
    const [opts] = argsOf(p) as [mcpRegister.McpRegistrationOptions];
    return mcpRegister.registerMcpWithOpenCode(opts);
  });

  bridge.handle('opencode.registerMcpWithRetry', (p) => {
    const [opts] = argsOf(p) as [mcpRegister.McpRetryOptions];
    return mcpRegister.registerMcpWithRetry(opts);
  });

  bridge.handle('opencode.registerMcpAcrossReachablePorts', (p) => {
    const [opts] = argsOf(p) as [mcpRegister.McpRegistrationOptions];
    return mcpRegister.registerMcpAcrossReachablePorts(opts);
  });

  // ── mcp-inject ───────────────────────────────────────────────────────────
  bridge.handle('opencode.injectProjectMcps', (p) => {
    const [opts] = argsOf(p) as [mcpInject.McpInjectionOptions];
    return mcpInject.injectProjectMcps(opts);
  });

  bridge.handle('opencode.recordInjectedMcps', (p) => {
    const [sessionId, names] = argsOf(p) as [string, string[]];
    mcpInject.recordInjectedMcps(sessionId, names);
  });

  // ── mcp-status ───────────────────────────────────────────────────────────
  bridge.handle('opencode.fetchMcpStatus', (p) => {
    const [port, dir] = argsOf(p) as [number, string | undefined];
    return mcpStatus.fetchMcpStatus(port, dir);
  });

  bridge.handle('opencode.connectMcp', (p) => {
    const [port, name, dir] = argsOf(p) as [number, string, string | undefined];
    return mcpStatus.connectMcp(port, name, dir);
  });

  bridge.handle('opencode.disconnectMcp', (p) => {
    const [port, name, dir] = argsOf(p) as [number, string, string | undefined];
    return mcpStatus.disconnectMcp(port, name, dir);
  });

  bridge.handle('opencode.registerMcp', (p) => {
    const [port, name, config, dir] = argsOf(p) as [
      number,
      string,
      Parameters<typeof mcpStatus.registerMcp>[2],
      string | undefined,
    ];
    return mcpStatus.registerMcp(port, name, config, dir);
  });

  bridge.handle('opencode.startMcpAuth', (p) => {
    const [port, name, dir] = argsOf(p) as [number, string, string | undefined];
    return mcpStatus.startMcpAuth(port, name, dir);
  });

  bridge.handle('opencode.callbackMcpAuth', (p) => {
    const [port, name, code, dir] = argsOf(p) as [
      number,
      string,
      string,
      string | undefined,
    ];
    return mcpStatus.callbackMcpAuth(port, name, code, dir);
  });

  bridge.handle('opencode.authenticateMcp', (p) => {
    const [port, name, dir] = argsOf(p) as [number, string, string | undefined];
    return mcpStatus.authenticateMcp(port, name, dir);
  });

  bridge.handle('opencode.removeMcpAuth', (p) => {
    const [port, name, dir] = argsOf(p) as [number, string, string | undefined];
    return mcpStatus.removeMcpAuth(port, name, dir);
  });

  // ── config-io ────────────────────────────────────────────────────────────
  bridge.handle('opencode.readGlobalConfig', () => {
    return configIo.readGlobalConfig();
  });

  bridge.handle('opencode.readProjectConfig', (p) => {
    const [baseDirectory] = argsOf(p) as [string];
    return configIo.readProjectConfig(baseDirectory);
  });

  bridge.handle('opencode.writeGlobalConfig', (p) => {
    const [data] = argsOf(p) as [Record<string, unknown>];
    return configIo.writeGlobalConfig(data);
  });

  bridge.handle('opencode.writeProjectConfig', (p) => {
    const [baseDirectory, data] = argsOf(p) as [
      string,
      Record<string, unknown>,
    ];
    return configIo.writeProjectConfig(baseDirectory, data);
  });

  // ── config-sync ──────────────────────────────────────────────────────────
  bridge.handle('opencode.syncRemoteConfig', (p) => {
    const [appPort, promptTimeoutSeconds] = argsOf(p) as [
      number,
      number | undefined,
    ];
    return configSync.syncRemoteConfig(appPort, promptTimeoutSeconds);
  });

  // ── agents ───────────────────────────────────────────────────────────────
  bridge.handle('opencode.listAgents', (p) => {
    const [baseDirectory] = argsOf(p) as [string | undefined];
    return agents.listAgents(baseDirectory);
  });

  bridge.handle('opencode.readAgent', (p) => {
    const [filePath] = argsOf(p) as [string];
    return agents.readAgent(filePath);
  });

  bridge.handle('opencode.writeAgent', (p) => {
    const [params] = argsOf(p) as [agents.WriteAgentParams];
    return agents.writeAgent(params);
  });

  bridge.handle('opencode.deleteAgent', (p) => {
    const [filePath] = argsOf(p) as [string];
    return agents.deleteAgent(filePath);
  });
}
