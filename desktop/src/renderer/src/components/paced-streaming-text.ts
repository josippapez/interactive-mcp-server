export const TEXT_RENDER_PACE_MS = 24;

const TEXT_RENDER_SNAP = /[\s.,!?;:)\]]/;

export function getNextPacedTextEnd(text: string, start: number): number {
  const end = Math.min(
    text.length,
    start + getPacedTextStep(text.length - start),
  );
  const max = Math.min(text.length, end + 8);
  for (let index = end; index < max; index += 1) {
    if (TEXT_RENDER_SNAP.test(text[index] ?? '')) return index + 1;
  }
  return end;
}

export function getPacedStreamingTextUpdate(input: {
  text: string;
  shown: string;
  streaming: boolean;
}): { value: string; done: boolean } {
  const { text, shown, streaming } = input;
  if (!streaming) return { value: text, done: true };
  if (!text.startsWith(shown) || text.length <= shown.length) {
    return { value: text, done: true };
  }

  const end = getNextPacedTextEnd(text, shown.length);
  return { value: text.slice(0, end), done: end >= text.length };
}

function getPacedTextStep(size: number): number {
  if (size <= 12) return 2;
  if (size <= 48) return 4;
  if (size <= 96) return 8;
  return Math.min(24, Math.ceil(size / 8));
}
