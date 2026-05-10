import { registerAgentsHandlers } from './handlers/agents-handlers';
import { registerContextTrackingHandlers } from './handlers/context-tracking-handlers';
import { registerConversationHandlers } from './handlers/conversation-handlers';
import { registerMcpStatusHandlers } from './handlers/mcp-status-handlers';
import { registerOpenCodeCoreHandlers } from './handlers/opencode-core-handlers';
import { registerOpenCodeStatusHandlers } from './handlers/opencode-status-handlers';
import { registerProviderHandlers } from './handlers/provider-handlers';
import { registerSessionChannelHandlers } from './handlers/session-channel-handlers';
import { registerSessionTreeHandlers } from './handlers/session-tree-handlers';
import { registerSettingsHandlers } from './handlers/settings-handlers';
import { registerRendererLogChannel } from './handlers/shared';
import { registerSkillsHandlers } from './handlers/skills-handlers';
import { registerSystemHandlers } from './handlers/system-handlers';
import { IpcHandlerDeps } from './handlers/types';

export type { IpcHandlerDeps } from './handlers/types';

export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  registerRendererLogChannel();
  registerSystemHandlers(deps);
  registerSettingsHandlers(deps);
  registerOpenCodeCoreHandlers(deps);
  registerSessionChannelHandlers(deps);
  registerSkillsHandlers(deps);
  registerSessionTreeHandlers(deps);
  registerOpenCodeStatusHandlers(deps);
  registerContextTrackingHandlers(deps);
  registerConversationHandlers(deps);
  registerProviderHandlers(deps);
  registerMcpStatusHandlers(deps);
  registerAgentsHandlers(deps);
}
