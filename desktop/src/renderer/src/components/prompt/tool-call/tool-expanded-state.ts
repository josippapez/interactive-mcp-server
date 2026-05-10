export function resolveNextToolExpandedState({
  currentExpanded,
  forceExpanded,
  isPending,
}: {
  currentExpanded: boolean;
  forceExpanded: boolean;
  isPending: boolean;
}): boolean {
  return currentExpanded || forceExpanded || isPending;
}
