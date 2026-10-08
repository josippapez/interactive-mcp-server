export function shouldShowSessionSkeleton(input: {
  isLoadingSessions: boolean;
  projectCount: number;
  hasDirectConnections: boolean;
}): boolean {
  return (
    input.isLoadingSessions &&
    input.projectCount === 0 &&
    !input.hasDirectConnections
  );
}
