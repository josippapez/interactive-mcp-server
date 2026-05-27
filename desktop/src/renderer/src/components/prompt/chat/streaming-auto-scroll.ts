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

function parseAutoScrollSignature(
  signature: string,
): { count: string; id: string } | null {
  const [count, id] = signature.split('|');
  if (!count || !id) return null;
  return { count, id };
}
