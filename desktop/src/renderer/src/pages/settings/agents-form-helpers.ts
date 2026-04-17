/**
 * Pure helpers for the Agents settings section form.
 * Extracted from the React component so they can be unit-tested without a DOM.
 */

const NAME_RE = /^[a-zA-Z0-9_-]+$/;

export function isValidAgentName(name: string): boolean {
  return NAME_RE.test(name);
}

/**
 * Parse a comma-separated list of tool names into the
 * `Record<string, boolean>` shape the `writeAgent` IPC expects.
 */
export function parseToolsInput(input: string): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const raw of input.split(',')) {
    const tool = raw.trim();
    if (tool.length === 0) continue;
    out[tool] = true;
  }
  return out;
}

/**
 * Format a `Record<string, boolean>` tool map back to a comma-separated
 * string of enabled tool names for display in a text input.
 */
export function formatToolsForInput(
  tools: Record<string, boolean> | undefined,
): string {
  if (!tools) return '';
  return Object.entries(tools)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .join(', ');
}

export type AgentFormValues = {
  scope: 'global' | 'project';
  name: string;
  description: string;
  model: string;
  toolsInput: string;
  body: string;
  baseDirectory?: string;
};

export type WriteAgentParams = {
  scope: 'global' | 'project';
  baseDirectory?: string;
  name: string;
  description: string;
  mode: string;
  tools: Record<string, boolean>;
  model?: string;
  body: string;
};

export function buildWriteAgentParams(
  values: AgentFormValues,
): WriteAgentParams {
  const trimmedModel = values.model.trim();
  return {
    scope: values.scope,
    baseDirectory: values.baseDirectory,
    name: values.name,
    description: values.description,
    mode: 'subagent',
    tools: parseToolsInput(values.toolsInput),
    model: trimmedModel.length > 0 ? trimmedModel : undefined,
    body: values.body,
  };
}
