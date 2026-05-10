import type { AgentDefinition } from '../../../../preload';

/**
 * Filter agents by name or description, case-insensitive.
 * Empty/whitespace-only queries return the full list unchanged.
 */
export function filterAgents(
  agents: AgentDefinition[],
  query: string,
): AgentDefinition[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return agents;

  return agents.filter((agent) => {
    return (
      agent.name.toLowerCase().includes(trimmed) ||
      agent.description.toLowerCase().includes(trimmed)
    );
  });
}

/**
 * Split agents into built-in, project-scoped, and global buckets.
 * Built-in (SDK-native) agents take precedence so TUI defaults like
 * `build` and `plan` are visually grouped separately from user agents.
 * Global agents marked `overridden: true` are excluded because they are
 * shadowed by a project-level agent of the same name.
 */
export function groupAgentsByScope(agents: AgentDefinition[]): {
  builtIn: AgentDefinition[];
  project: AgentDefinition[];
  global: AgentDefinition[];
} {
  const builtIn: AgentDefinition[] = [];
  const project: AgentDefinition[] = [];
  const global: AgentDefinition[] = [];

  for (const agent of agents) {
    if (agent.native) {
      builtIn.push(agent);
    } else if (agent.scope === 'project') {
      project.push(agent);
    } else if (agent.scope === 'global' && !agent.overridden) {
      global.push(agent);
    }
  }

  return { builtIn, project, global };
}

export function getDefaultNativeAgentName(
  agents: AgentDefinition[],
  explicitDefault?: string | null,
): string | null {
  return (
    explicitDefault ??
    agents.find((agent) => agent.mode === 'primary' && agent.native)?.name ??
    null
  );
}
