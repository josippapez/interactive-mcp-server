import * as OpenTuiCore from '@opentui/core';
import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { copyTextToClipboard } from '@/utils/clipboard.js';
import { openExternalLink } from '@/utils/open-external-link.js';

interface MarkdownTextProps {
  content: string;
  streaming?: boolean;
  showContentCopyControl?: boolean;
  contentCopyLabel?: string;
  showCodeCopyControls?: boolean;
  codeBlockMaxVisibleLines?: number;
}

interface SyntaxStyleLike {
  create?: () => unknown;
  fromStyles?: (styles: Record<string, unknown>) => unknown;
}

interface RgbaLike {
  fromHex: (hex: string) => unknown;
}

const { SyntaxStyle, RGBA } = OpenTuiCore as unknown as {
  SyntaxStyle: SyntaxStyleLike;
  RGBA?: RgbaLike;
};

interface MarkdownSegment {
  type: 'markdown' | 'code';
  value: string;
  language?: string;
}

interface ParsedUnifiedDiff {
  oldCode: string;
  newCode: string;
  unifiedDiff: string;
}

interface MarkdownInlineSegment {
  type: 'text' | 'link';
  value: string;
  href?: string;
}

const CODE_BLOCK_REGEX = /```([^\n`]*)\n?([\s\S]*?)```/g;
const INLINE_LINK_REGEX =
  /\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,!?;:])/g;
const DIFF_LANGUAGES = new Set(['diff', 'patch']);
const VSCODE_FILE_LINK_REGEX = /^vscode(-insiders)?:\/\/file\//;

const LANGUAGE_TO_FILETYPE: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'tsx',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
};

function normalizeFiletype(language?: string): string | undefined {
  if (!language) {
    return undefined;
  }

  const normalized = language.trim().toLowerCase();
  return LANGUAGE_TO_FILETYPE[normalized] ?? normalized;
}

function extractDiffFiletype(diffContent: string): string | undefined {
  const fileLineMatch = diffContent.match(
    /^(?:\+\+\+|---)\s+(?:[ab]\/)?(.+)$/m,
  );
  if (!fileLineMatch || !fileLineMatch[1]) {
    return undefined;
  }

  const extensionMatch = fileLineMatch[1].match(/\.([a-zA-Z0-9]+)$/);
  if (!extensionMatch || !extensionMatch[1]) {
    return undefined;
  }

  return normalizeFiletype(extensionMatch[1]);
}

function isLikelyUnifiedDiff(content: string): boolean {
  const hasFileHeaders =
    /^---\s+/m.test(content) && /^\+\+\+\s+/m.test(content);
  const hasHunkHeader = /^@@\s+/m.test(content);
  const hasAddedOrRemovedLines = /^[+-](?![+-])\s?.+/m.test(content);
  const hasGitHeader = /^diff --git\s+/m.test(content);
  return (
    (hasFileHeaders || hasGitHeader || hasHunkHeader) && hasAddedOrRemovedLines
  );
}

function parseUnifiedDiff(content: string): ParsedUnifiedDiff | null {
  const normalizedContent = content.replace(/\r\n/g, '\n');
  const lines = normalizedContent.split('\n');
  const oldLines: string[] = [];
  const newLines: string[] = [];
  const hunkLines: string[] = [];
  let oldPath = 'a/file';
  let newPath = 'b/file';
  let inHunk = false;
  let hasHunkContent = false;

  for (const rawLine of lines) {
    if (!inHunk) {
      const oldPathMatch = rawLine.match(/^---\s+(.+)$/);
      if (oldPathMatch) {
        oldPath = oldPathMatch[1].split('\t')[0].trim() || oldPath;
        continue;
      }

      const newPathMatch = rawLine.match(/^\+\+\+\s+(.+)$/);
      if (newPathMatch) {
        newPath = newPathMatch[1].split('\t')[0].trim() || newPath;
        continue;
      }
    }

    if (rawLine.startsWith('@@')) {
      inHunk = true;
      continue;
    }

    if (!inHunk) {
      const startsLikeDiffLine =
        rawLine.startsWith('+') ||
        rawLine.startsWith('-') ||
        rawLine.startsWith(' ');
      if (
        startsLikeDiffLine &&
        !rawLine.startsWith('+++') &&
        !rawLine.startsWith('---')
      ) {
        inHunk = true;
      } else {
        continue;
      }
    }

    if (rawLine === '\\ No newline at end of file') {
      continue;
    }

    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      const line = rawLine.slice(1);
      newLines.push(line);
      hunkLines.push(`+${line}`);
      hasHunkContent = true;
      continue;
    }

    if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
      const line = rawLine.slice(1);
      oldLines.push(line);
      hunkLines.push(`-${line}`);
      hasHunkContent = true;
      continue;
    }

    if (rawLine.startsWith(' ')) {
      const line = rawLine.slice(1);
      oldLines.push(line);
      newLines.push(line);
      hunkLines.push(` ${line}`);
      hasHunkContent = true;
      continue;
    }

    if (rawLine.length === 0) {
      continue;
    }

    return null;
  }

  if (!hasHunkContent) {
    return null;
  }

  const oldCount = oldLines.length;
  const newCount = newLines.length;
  const unifiedDiff = [
    `--- ${oldPath}`,
    `+++ ${newPath}`,
    `@@ -1,${oldCount} +1,${newCount} @@`,
    ...hunkLines,
  ].join('\n');

  return {
    oldCode: oldLines.join('\n'),
    newCode: newLines.join('\n'),
    unifiedDiff,
  };
}

function splitMarkdownSegments(content: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(CODE_BLOCK_REGEX)) {
    const [fullMatch, rawLanguage = '', rawCode = ''] = match;
    if (typeof fullMatch !== 'string' || typeof match.index !== 'number') {
      continue;
    }

    if (match.index > lastIndex) {
      segments.push({
        type: 'markdown',
        value: content.slice(lastIndex, match.index),
      });
    }

    segments.push({
      type: 'code',
      language: rawLanguage.trim() || undefined,
      value: rawCode,
    });
    lastIndex = match.index + fullMatch.length;
  }

  if (lastIndex < content.length) {
    segments.push({
      type: 'markdown',
      value: content.slice(lastIndex),
    });
  }

  if (segments.length === 0) {
    return [{ type: 'markdown', value: content }];
  }

  return segments;
}

function parseMarkdownInlineLinks(content: string): MarkdownInlineSegment[] {
  const segments: MarkdownInlineSegment[] = [];
  let lastIndex = 0;
  INLINE_LINK_REGEX.lastIndex = 0;

  for (const match of content.matchAll(INLINE_LINK_REGEX)) {
    const fullMatch = match[0];
    if (typeof fullMatch !== 'string' || typeof match.index !== 'number') {
      continue;
    }

    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        value: content.slice(lastIndex, match.index),
      });
    }

    const markdownLabel = match[1];
    const markdownHref = match[2];
    const rawHref = match[3];
    const href = markdownHref ?? rawHref;
    const label = markdownLabel ?? rawHref;

    if (href && label) {
      segments.push({
        type: 'link',
        value: label,
        href,
      });
    } else {
      segments.push({
        type: 'text',
        value: fullMatch,
      });
    }

    lastIndex = match.index + fullMatch.length;
  }

  if (lastIndex < content.length) {
    segments.push({
      type: 'text',
      value: content.slice(lastIndex),
    });
  }

  return segments.length > 0 ? segments : [{ type: 'text', value: content }];
}

function isVscodeFileLink(href: string): boolean {
  return VSCODE_FILE_LINK_REGEX.test(href);
}

export function MarkdownText({
  content,
  streaming = false,
  showContentCopyControl = false,
  contentCopyLabel = 'Copy text',
  showCodeCopyControls = false,
  codeBlockMaxVisibleLines,
}: MarkdownTextProps) {
  const syntaxStyle = useMemo(() => {
    const toColor = (hex: string): unknown =>
      typeof RGBA?.fromHex === 'function' ? RGBA.fromHex(hex) : hex;

    if (typeof SyntaxStyle.fromStyles === 'function') {
      return SyntaxStyle.fromStyles({
        keyword: { fg: toColor('#FF7B72'), bold: true },
        string: { fg: toColor('#A5D6FF') },
        comment: { fg: toColor('#8B949E'), italic: true },
        number: { fg: toColor('#79C0FF') },
        function: { fg: toColor('#D2A8FF') },
        type: { fg: toColor('#FFA657') },
        operator: { fg: toColor('#FF7B72') },
        property: { fg: toColor('#79C0FF') },
        default: { fg: toColor('#E6EDF3') },
      });
    }

    if (typeof SyntaxStyle.create === 'function') {
      return SyntaxStyle.create();
    }

    return undefined;
  }, []);
  const segments = useMemo(() => splitMarkdownSegments(content), [content]);
  const [clipboardHint, setClipboardHint] = useState<string | null>(null);
  const [copiedSnippetIndex, setCopiedSnippetIndex] = useState<number | null>(
    null,
  );
  const clipboardHintTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const copiedSnippetTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (clipboardHintTimeoutRef.current) {
        clearTimeout(clipboardHintTimeoutRef.current);
      }
      if (copiedSnippetTimeoutRef.current) {
        clearTimeout(copiedSnippetTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!clipboardHint) {
      if (clipboardHintTimeoutRef.current) {
        clearTimeout(clipboardHintTimeoutRef.current);
        clipboardHintTimeoutRef.current = null;
      }
      return;
    }

    if (clipboardHintTimeoutRef.current) {
      clearTimeout(clipboardHintTimeoutRef.current);
    }

    clipboardHintTimeoutRef.current = setTimeout(() => {
      setClipboardHint(null);
      clipboardHintTimeoutRef.current = null;
    }, 2000);

    return () => {
      if (clipboardHintTimeoutRef.current) {
        clearTimeout(clipboardHintTimeoutRef.current);
        clipboardHintTimeoutRef.current = null;
      }
    };
  }, [clipboardHint]);

  const copyWithHint = useCallback(
    async (value: string, successMessage: string): Promise<void> => {
      if (!value) {
        setClipboardHint('Nothing to copy.');
        return;
      }

      try {
        await copyTextToClipboard(value);
        setClipboardHint(successMessage);
      } catch (error: unknown) {
        setClipboardHint(
          `Copy failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [],
  );

  const openLinkWithHint = useCallback(
    async (href: string, target: 'default' | 'vscode' | 'vscode-insiders') => {
      try {
        await openExternalLink(href, target);
        setClipboardHint('Opening link…');
      } catch (error: unknown) {
        setClipboardHint(
          `Open link failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [],
  );

  if (!content) {
    return null;
  }

  return (
    <box flexDirection="column" width="100%" gap={1}>
      {showContentCopyControl && (
        <box width="100%" justifyContent="flex-end">
          <text
            fg="cyan"
            onMouseUp={() => {
              void copyWithHint(content, 'Prompt copied to clipboard.');
            }}
          >
            [{contentCopyLabel}]
          </text>
        </box>
      )}

      {segments.map((segment, index) => {
        if (segment.type === 'markdown') {
          if (!segment.value.trim()) {
            const spacerHeight = Math.max(
              1,
              segment.value.split('\n').length - 1,
            );
            return <box key={`segment-${index}`} height={spacerHeight} />;
          }

          INLINE_LINK_REGEX.lastIndex = 0;
          if (INLINE_LINK_REGEX.test(segment.value)) {
            INLINE_LINK_REGEX.lastIndex = 0;
            const lines = segment.value.split('\n');
            return (
              <box key={`segment-${index}`} flexDirection="column" width="100%">
                {lines.map((line, lineIndex) => {
                  if (!line) {
                    return (
                      <box
                        key={`segment-${index}-line-${lineIndex}`}
                        height={1}
                      />
                    );
                  }

                  const inlineSegments = parseMarkdownInlineLinks(line);
                  return (
                    <box
                      key={`segment-${index}-line-${lineIndex}`}
                      flexDirection="row"
                      flexWrap="wrap"
                      width="100%"
                    >
                      {inlineSegments.flatMap(
                        (inlineSegment, inlineSegmentIndex) => {
                          const baseKey = `segment-${index}-line-${lineIndex}-part-${inlineSegmentIndex}`;

                          if (
                            inlineSegment.type !== 'link' ||
                            !inlineSegment.href
                          ) {
                            return (
                              <text key={baseKey} wrapMode="word">
                                {inlineSegment.value}
                              </text>
                            );
                          }

                          if (!isVscodeFileLink(inlineSegment.href)) {
                            return (
                              <text
                                key={baseKey}
                                fg="cyan"
                                wrapMode="char"
                                onMouseUp={() => {
                                  void openLinkWithHint(
                                    inlineSegment.href ?? '',
                                    'default',
                                  );
                                }}
                              >
                                {inlineSegment.value}
                              </text>
                            );
                          }

                          return [
                            <text key={`${baseKey}-label`} wrapMode="word">
                              {inlineSegment.value}
                            </text>,
                            <text
                              key={`${baseKey}-open-paren`}
                              fg="gray"
                              wrapMode="word"
                            >
                              {' ('}
                            </text>,
                            <text
                              key={`${baseKey}-vscode`}
                              fg="cyan"
                              wrapMode="word"
                              onMouseUp={() => {
                                void openLinkWithHint(
                                  inlineSegment.href ?? '',
                                  'vscode',
                                );
                              }}
                            >
                              VS Code
                            </text>,
                            <text
                              key={`${baseKey}-separator`}
                              fg="gray"
                              wrapMode="word"
                            >
                              {' | '}
                            </text>,
                            <text
                              key={`${baseKey}-insiders`}
                              fg="cyan"
                              wrapMode="word"
                              onMouseUp={() => {
                                void openLinkWithHint(
                                  inlineSegment.href ?? '',
                                  'vscode-insiders',
                                );
                              }}
                            >
                              VS Code Insiders
                            </text>,
                            <text
                              key={`${baseKey}-close-paren`}
                              fg="gray"
                              wrapMode="word"
                            >
                              {')'}
                            </text>,
                          ];
                        },
                      )}
                    </box>
                  );
                })}
              </box>
            );
          }

          return (
            <markdown
              key={`segment-${index}`}
              content={segment.value}
              syntaxStyle={syntaxStyle as never}
              conceal
              streaming={streaming}
            />
          );
        }

        const normalizedLanguage = normalizeFiletype(segment.language);
        const isDiffSegment =
          normalizedLanguage !== undefined &&
          DIFF_LANGUAGES.has(normalizedLanguage);
        const lineCount = segment.value.split('\n').length;
        const shouldLimitCodeHeight =
          typeof codeBlockMaxVisibleLines === 'number' &&
          codeBlockMaxVisibleLines > 0 &&
          lineCount > codeBlockMaxVisibleLines;
        const parsedDiff = isDiffSegment
          ? parseUnifiedDiff(segment.value)
          : null;
        const diffLanguage = extractDiffFiletype(segment.value);
        const codeProps = {
          code: segment.value,
          language: normalizedLanguage,
          content: segment.value,
          filetype: normalizedLanguage,
          syntaxStyle: syntaxStyle as never,
          conceal: true,
          streaming,
          wrapMode: 'word' as const,
          width: '100%',
        } as Record<string, unknown>;
        const codeElement = createElement('code', codeProps);
        const codeRenderable = codeElement;
        const diffProps = parsedDiff
          ? ({
              oldCode: parsedDiff.oldCode,
              newCode: parsedDiff.newCode,
              language: diffLanguage,
              mode: 'unified',
              diff: parsedDiff.unifiedDiff,
              view: 'unified',
              filetype: diffLanguage,
              syntaxStyle: syntaxStyle as never,
              showLineNumbers: true,
              conceal: true,
              wrapMode: 'word',
              width: '100%',
            } as Record<string, unknown>)
          : null;
        const diffRenderable = parsedDiff
          ? createElement('diff', diffProps as Record<string, unknown>)
          : null;
        const codeDescription = isDiffSegment
          ? 'Diff snippet'
          : normalizedLanguage
            ? `${normalizedLanguage} snippet`
            : 'Code snippet';
        const shouldRenderDiff =
          isDiffSegment && isLikelyUnifiedDiff(segment.value) && diffRenderable;
        const snippetRenderable = shouldRenderDiff
          ? diffRenderable
          : codeRenderable;

        return (
          <box key={`segment-${index}`} flexDirection="column" width="100%">
            {showCodeCopyControls && (
              <box width="100%" justifyContent="space-between">
                <text fg="gray">{codeDescription}</text>
                <text
                  fg="cyan"
                  onMouseUp={() => {
                    setCopiedSnippetIndex(index);
                    if (copiedSnippetTimeoutRef.current) {
                      clearTimeout(copiedSnippetTimeoutRef.current);
                    }
                    copiedSnippetTimeoutRef.current = setTimeout(() => {
                      setCopiedSnippetIndex((currentIndex) =>
                        currentIndex === index ? null : currentIndex,
                      );
                    }, 1200);
                    void copyWithHint(
                      segment.value,
                      'Code snippet copied to clipboard.',
                    );
                  }}
                >
                  [{copiedSnippetIndex === index ? 'Copied!' : 'Copy code'}]
                </text>
              </box>
            )}
            <box
              width="100%"
              border
              borderStyle="single"
              borderColor="gray"
              paddingLeft={1}
              marginLeft={1}
            >
              {shouldLimitCodeHeight ? (
                <scrollbox
                  width="100%"
                  height={codeBlockMaxVisibleLines}
                  scrollY
                  viewportCulling={false}
                  scrollbarOptions={{
                    showArrows: false,
                  }}
                >
                  {snippetRenderable}
                </scrollbox>
              ) : (
                snippetRenderable
              )}
            </box>
          </box>
        );
      })}

      {clipboardHint && <text fg="gray">{clipboardHint}</text>}
    </box>
  );
}
