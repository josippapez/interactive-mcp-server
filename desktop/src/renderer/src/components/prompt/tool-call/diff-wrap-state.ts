export type DiffWrapState = Record<string, boolean>;

export function toggleDiffWrapState(
  state: DiffWrapState,
  diffId: string,
): DiffWrapState {
  return {
    ...state,
    [diffId]: !state[diffId],
  };
}

export function pruneDiffWrapState(
  state: DiffWrapState,
  activeDiffIds: ReadonlyArray<string>,
): DiffWrapState {
  const activeIds = new Set(activeDiffIds);
  return Object.fromEntries(
    Object.entries(state).filter(([diffId]) => activeIds.has(diffId)),
  );
}
