import { contextBridge } from 'electron';

import { createAgentsApi } from './api/agents';
import { createEventsApi } from './api/events';
import { createMcpApi } from './api/mcp';
import { createOpenCodeConfigApi } from './api/opencode-config';
import { createOpenCodeSessionsApi } from './api/opencode-sessions';
import { createProvidersApi } from './api/providers';
import { createSessionsApi } from './api/sessions';
import { createSettingsApi } from './api/settings';
import { createSkillsApi } from './api/skills';
import { createSystemApi } from './api/system';

// Re-export all public types so existing renderer imports
// (`import type { ElectronAPI, PromptRequest, ... } from '../../preload/index'`)
// keep working unchanged.
export type {
  AgentDefinition,
  AppSettings,
  Attachment,
  AuthMethod,
  AuthPrompt,
  AuthorizeResult,
  ConversationMessage,
  ConversationMessagePart,
  ConversationMessageRole,
  ConversationPartType,
  ConversationRecord,
  McpAuthResult,
  PendingPermissionRequest,
  PendingQuestionRequest,
  PromptClearData,
  PromptRequest,
  PromptWhen,
  ProviderActionResult,
  ProviderStatus,
  SelectPrompt,
  SessionChannelHistoryRecord,
  NativeOpenCodeSkill,
  OpenCodeConfigDefaults,
  SkillOrInstructionRecord,
  TextPrompt,
} from './api/types';

// Merge every domain module into the single `window.api` surface. Shape and
// property names are identical to the pre-split API — each module's factory
// returns a plain object that is spread here.
const api = {
  ...createEventsApi(),
  ...createSessionsApi(),
  ...createSettingsApi(),
  ...createSystemApi(),
  ...createProvidersApi(),
  ...createOpenCodeSessionsApi(),
  ...createOpenCodeConfigApi(),
  ...createAgentsApi(),
  ...createSkillsApi(),
  ...createMcpApi(),
};

contextBridge.exposeInMainWorld('api', api);

export type ElectronAPI = typeof api;
