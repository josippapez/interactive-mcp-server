export function getDisplayToolName(name: string): string {
  const mcpMatch = name.match(/^mcp__[^_]+__(.+)$/);
  if (mcpMatch) return mcpMatch[1];

  const colonIdx = name.indexOf('::');
  if (colonIdx >= 0) return name.slice(colonIdx + 2);

  return name;
}

export function shouldShowToolSubtitle(
  title: string,
  subtitle: string | null | undefined,
): subtitle is string {
  if (!subtitle) return false;
  return !title.toLowerCase().includes(subtitle.toLowerCase());
}
