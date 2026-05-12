/**
 * Pure helpers for BackgroundSubagentToolCard — no React or renderer
 * imports so they can be unit-tested without the full renderer chain.
 */

export type SubagentAction =
  | 'start'
  | 'models'
  | 'list'
  | 'status'
  | 'output'
  | 'cancel';

const KNOWN_ACTIONS = new Set<SubagentAction>([
  'start',
  'models',
  'list',
  'status',
  'output',
  'cancel',
]);

/** Resolve the action field from a tool input record. */
export function resolveAction(
  input: Record<string, unknown> | undefined,
): SubagentAction | null {
  const raw = input?.['action'];
  if (typeof raw !== 'string') return null;
  const lower = raw.toLowerCase().trim() as SubagentAction;
  return KNOWN_ACTIONS.has(lower) ? lower : null;
}

const ACTION_TITLES: Record<Exclude<SubagentAction, 'start'>, string> = {
  models: 'Background models',
  list: 'Background subagents',
  status: 'Background status',
  output: 'Background output',
  cancel: 'Cancel background subagent',
};

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function resolveBackgroundSubagentTitle(
  input: Record<string, unknown> | undefined,
): string {
  const action = resolveAction(input);
  if (action && action !== 'start') return ACTION_TITLES[action];
  return (
    readString(input?.['agent']) ??
    readString(input?.['title']) ??
    'Background Agent'
  );
}
