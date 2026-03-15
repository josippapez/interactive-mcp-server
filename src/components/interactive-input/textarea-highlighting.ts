import * as OpenTuiCore from '@opentui/core';

export type TextareaHighlightKind = 'link' | 'code';

export interface TextareaHighlightRange {
  start: number;
  end: number;
  kind: TextareaHighlightKind;
}

export interface TextareaHighlightStyleIds {
  link: number;
  code: number;
}

export interface TextareaSyntaxHighlighting {
  syntaxStyle: unknown;
  styleIds: TextareaHighlightStyleIds;
}

export interface TextareaHighlightableLike {
  clearAllHighlights?: () => void;
  addHighlightByCharRange?: (highlight: {
    start: number;
    end: number;
    styleId: number;
  }) => void;
}

interface SyntaxStyleLike {
  fromStyles?: (styles: Record<string, unknown>) => unknown;
}

interface RgbaLike {
  fromHex: (hex: string) => unknown;
}

const { SyntaxStyle, RGBA } = OpenTuiCore as unknown as {
  SyntaxStyle: SyntaxStyleLike;
  RGBA?: RgbaLike;
};

const FENCED_CODE_REGEX = /```[^`\n]*\n[\s\S]*?\n```(?=\s|$)/g;
const INLINE_CODE_REGEX = /`[^`\n]+`/g;
const MARKDOWN_LINK_REGEX = /\[[^\]\n]+\]\((?:https?:\/\/|mailto:)[^)]+?\)/g;
const URL_REGEX = /\b(?:https?:\/\/|mailto:)[^\s<>()]+/g;

const hasOverlap = (
  ranges: TextareaHighlightRange[],
  nextStart: number,
  nextEnd: number,
) => ranges.some((range) => nextStart < range.end && nextEnd > range.start);

const collectMatches = (
  text: string,
  regex: RegExp,
  kind: 'link' | 'code',
  ranges: TextareaHighlightRange[],
  offset = 0,
) => {
  const effectiveRegex = new RegExp(regex.source, regex.flags);
  for (const match of text.matchAll(effectiveRegex)) {
    const fullMatch = match[0];
    if (typeof match.index !== 'number' || fullMatch.length === 0) {
      continue;
    }

    const start = offset + match.index;
    const end = start + fullMatch.length;
    if (hasOverlap(ranges, start, end)) {
      continue;
    }

    ranges.push({ start, end, kind });
  }
};

export const getTextareaHighlightRanges = (
  value: string,
): TextareaHighlightRange[] => {
  const ranges: TextareaHighlightRange[] = [];

  collectMatches(value, FENCED_CODE_REGEX, 'code', ranges);
  collectMatches(value, INLINE_CODE_REGEX, 'code', ranges);
  collectMatches(value, MARKDOWN_LINK_REGEX, 'link', ranges);
  collectMatches(value, URL_REGEX, 'link', ranges);

  return ranges.sort((left, right) =>
    left.start === right.start
      ? left.end - right.end
      : left.start - right.start,
  );
};

export const applyTextareaHighlights = ({
  textarea,
  value,
  styleIds,
}: {
  textarea: TextareaHighlightableLike | null | undefined;
  value: string;
  styleIds: TextareaHighlightStyleIds | null | undefined;
}) => {
  if (!textarea || !styleIds) {
    return;
  }

  textarea.clearAllHighlights?.();

  const ranges = getTextareaHighlightRanges(value);
  for (const range of ranges) {
    const styleId = range.kind === 'link' ? styleIds.link : styleIds.code;

    if (typeof styleId !== 'number') {
      continue;
    }

    textarea.addHighlightByCharRange?.({
      start: range.start,
      end: range.end,
      styleId,
    });
  }
};

export const createTextareaSyntaxHighlighting =
  (): TextareaSyntaxHighlighting | null => {
    if (typeof SyntaxStyle.fromStyles !== 'function') {
      return null;
    }

    const toColor = (hex: string) =>
      typeof RGBA?.fromHex === 'function' ? RGBA.fromHex(hex) : undefined;

    const syntaxStyle = SyntaxStyle.fromStyles({
      default: { fg: toColor('#E6EDF3') },
      link: { fg: toColor('#58A6FF'), underline: true },
      code: { fg: toColor('#FFA657') },
    });

    const styleResolver = syntaxStyle as {
      getStyleId?: (name: string) => number | null;
      resolveStyleId?: (name: string) => number | null;
    };
    const resolveStyleId = (name: string): number | null => {
      const rawStyleId =
        styleResolver.getStyleId?.(name) ??
        styleResolver.resolveStyleId?.(name);
      return typeof rawStyleId === 'number' ? rawStyleId : null;
    };

    const linkStyleId = resolveStyleId('link');
    const codeStyleId = resolveStyleId('code');

    if (linkStyleId === null || codeStyleId === null) {
      return null;
    }

    const styleIds: TextareaHighlightStyleIds = {
      link: linkStyleId,
      code: codeStyleId,
    };

    return {
      syntaxStyle,
      styleIds,
    };
  };
