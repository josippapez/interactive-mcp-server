import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80',
        outline: 'text-foreground',
        // Effort level variants
        'effort-low':
          'border-emerald-500/30 bg-emerald-500/15 text-emerald-400',
        'effort-medium': 'border-blue-500/30 bg-blue-500/15 text-blue-400',
        'effort-high': 'border-amber-500/30 bg-amber-500/15 text-amber-400',
        'effort-xhigh': 'border-purple-500/30 bg-purple-500/15 text-purple-400',
        // Tool status variants
        'status-pending':
          'border-transparent bg-[var(--color-text-muted)]/20 text-[var(--color-text-muted)]',
        'status-running':
          'border-transparent bg-[var(--color-agent)]/20 text-[var(--color-agent)]',
        'status-completed':
          'border-transparent bg-[var(--color-success)]/20 text-[var(--color-success,#22c55e)]',
        'status-error':
          'border-transparent bg-[var(--color-error)]/20 text-[var(--color-error)]',
      },
      size: {
        default: 'px-2.5 py-0.5 text-xs',
        sm: 'px-1.5 py-0.5 text-[9px]',
        xs: 'px-1 py-0.5 text-[10px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({
  className,
  variant,
  size,
  ...props
}: BadgeProps): React.ReactElement {
  return (
    <div
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
