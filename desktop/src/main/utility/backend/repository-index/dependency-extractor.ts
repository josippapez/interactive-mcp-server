import type { ExtractedDependency, RepositoryDependencyKind } from './types';

export function extractDependenciesFromSource(
  sourceText: string,
  filePath: string,
): ExtractedDependency[] {
  if (!isJavaScriptLike(filePath)) return [];

  const dependencies: ExtractedDependency[] = [];
  const seen = new Set<string>();

  function add(
    specifier: string,
    kind: RepositoryDependencyKind,
    matchText: string,
    matchIndex: number,
  ): void {
    const trimmed = specifier.trim();
    if (!trimmed) return;
    const key = `${kind}:${trimmed}`;
    if (seen.has(key)) return;
    seen.add(key);
    const specifierOffset = matchText.indexOf(specifier);
    const specifierIndex =
      specifierOffset === -1 ? matchIndex : matchIndex + specifierOffset;
    dependencies.push({
      specifier: trimmed,
      kind,
      ...getLineContext(sourceText, specifierIndex),
    });
  }

  for (const match of sourceText.matchAll(STATIC_IMPORT_RE)) {
    add(match[1], 'import', match[0], match.index ?? 0);
  }
  for (const match of sourceText.matchAll(BARE_IMPORT_RE)) {
    add(match[1], 'import', match[0], match.index ?? 0);
  }
  for (const match of sourceText.matchAll(EXPORT_FROM_RE)) {
    add(match[1], 'export', match[0], match.index ?? 0);
  }
  for (const match of sourceText.matchAll(DYNAMIC_IMPORT_RE)) {
    add(match[1], 'dynamic-import', match[0], match.index ?? 0);
  }
  for (const match of sourceText.matchAll(REQUIRE_RE)) {
    add(match[1], 'require', match[0], match.index ?? 0);
  }

  return dependencies;
}

function isJavaScriptLike(filePath: string): boolean {
  return /\.(cjs|mjs|js|jsx|ts|tsx)$/.test(filePath);
}

function getLineContext(
  sourceText: string,
  characterIndex: number,
): Pick<ExtractedDependency, 'lineNumber' | 'lineSnippet'> {
  const safeIndex = Math.max(0, Math.min(characterIndex, sourceText.length));
  const lineStart = sourceText.lastIndexOf('\n', safeIndex - 1) + 1;
  const nextLineBreak = sourceText.indexOf('\n', safeIndex);
  const lineEnd = nextLineBreak === -1 ? sourceText.length : nextLineBreak;
  const lineNumber = sourceText.slice(0, lineStart).split('\n').length;
  const lineSnippet = sourceText.slice(lineStart, lineEnd).trim();

  return { lineNumber, lineSnippet };
}

const STRING = String.raw`["']([^"']+)["']`;
const STATIC_IMPORT_RE = new RegExp(
  String.raw`\bimport\s+(?:type\s+)?(?:[\s\S]*?)\s+from\s+${STRING}`,
  'g',
);
const BARE_IMPORT_RE = new RegExp(String.raw`\bimport\s+${STRING}`, 'g');
const EXPORT_FROM_RE = new RegExp(
  String.raw`\bexport\s+(?:type\s+)?(?:[\s\S]*?)\s+from\s+${STRING}`,
  'g',
);
const DYNAMIC_IMPORT_RE = new RegExp(
  String.raw`\bimport\s*\(\s*${STRING}\s*\)`,
  'g',
);
const REQUIRE_RE = new RegExp(String.raw`\brequire\s*\(\s*${STRING}\s*\)`, 'g');
