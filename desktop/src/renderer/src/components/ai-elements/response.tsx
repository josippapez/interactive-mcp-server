'use client';

import { cjk } from '@streamdown/cjk';
import { code } from '@streamdown/code';
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import type { ComponentProps } from 'react';
import { memo } from 'react';
import { Streamdown } from 'streamdown';
import { cn } from '../../lib/utils';

export type ResponseProps = ComponentProps<typeof Streamdown>;

const streamdownPlugins = { cjk, code, math, mermaid };

/**
 * Shiki theme pair used across the app (CodeBlock, DiffView, and markdown
 * code blocks inside assistant messages). Keeping a single source of truth
 * ensures token colors line up with our dual-theme Shiki caches.
 */
const SHIKI_THEMES: [string, string] = ['github-light', 'github-dark'];

/**
 * Streaming-aware markdown renderer. Thin wrapper over `Streamdown` (the
 * engine that powers AI Elements' `MessageResponse`) — heals unterminated
 * code fences and tables during token streaming without flicker.
 *
 * Memoized on `children` and `isAnimating` to match the AI Elements
 * reference implementation.
 */
export const Response = memo(
  ({ className, lineNumbers, shikiTheme, ...props }: ResponseProps) => (
    <Streamdown
      className={cn(
        'size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        className,
      )}
      lineNumbers={lineNumbers ?? false}
      plugins={streamdownPlugins}
      shikiTheme={
        shikiTheme ??
        (SHIKI_THEMES as unknown as ComponentProps<
          typeof Streamdown
        >['shikiTheme'])
      }
      {...props}
    />
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    nextProps.isAnimating === prevProps.isAnimating,
);

Response.displayName = 'Response';
