export function shouldDelayStreamingAutoScroll(input: {
  previousSignature: string | null;
  nextSignature: string;
}): boolean {
  if (!input.previousSignature) return false;

  const previous = parseAutoScrollSignature(input.previousSignature);
  const next = parseAutoScrollSignature(input.nextSignature);
  if (!previous || !next) return false;
  return previous.count === next.count && previous.id === next.id;
}

export const BOTTOM_ANCHOR_INITIAL_FRAMES = 90;
export const BOTTOM_ANCHOR_WORKING_TAIL_FRAMES = 12;

export function getNextBottomAnchorFrameCount(input: {
  remainingFrames: number;
  working: boolean;
}): number {
  if (input.working) return BOTTOM_ANCHOR_WORKING_TAIL_FRAMES;
  return Math.max(0, input.remainingFrames - 1);
}

function parseAutoScrollSignature(
  signature: string,
): { count: string; id: string } | null {
  const [count, id] = signature.split('|');
  if (!count || !id) return null;
  return { count, id };
}
