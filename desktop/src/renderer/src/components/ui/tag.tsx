import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Tag — small pill-shaped label with a leading icon slot.
 *
 * Use for status chips in chat (SENT / SENDING / QUEUED), pending-prompt
 * indicators, and similar inline status affordances. Tokens come from the
 * semantic surface/border/text-on-* scale so the component follows theme
 * swaps automatically.
 *
 * For generic badges (counts, labels), prefer `<Badge>` from `./badge`.
 */
const tagVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide',
  {
    variants: {
      tone: {
        success:
          'border-[var(--border-success)] bg-[var(--surface-success)] text-[var(--text-on-success)]',
        info: 'border-[var(--border-info)] bg-[var(--surface-info)] text-[var(--text-on-info)]',
        warning:
          'border-[var(--border-warning)] bg-[var(--surface-warning)] text-[var(--text-on-warning)]',
        critical:
          'border-[var(--border-critical)] bg-[var(--surface-critical)] text-[var(--text-on-critical)]',
        neutral:
          'border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]',
      },
    },
    defaultVariants: {
      tone: 'neutral',
    },
  },
);

export interface TagProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof tagVariants> {
  /** Optional leading icon node (typically a small inline SVG at 10px). */
  icon?: React.ReactNode;
}

function Tag({
  className,
  tone,
  icon,
  children,
  ...props
}: TagProps): React.ReactElement {
  return (
    <span className={cn(tagVariants({ tone }), className)} {...props}>
      {icon}
      {children}
    </span>
  );
}

export { Tag, tagVariants };
