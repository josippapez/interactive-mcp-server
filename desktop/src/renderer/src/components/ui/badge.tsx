import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden [&_[data-icon=inline-start]]:mr-1 [&_[data-icon=inline-end]]:ml-1',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90',
        destructive:
          'border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        outline:
          'text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        ghost:
          'border-transparent bg-transparent text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        link: 'border-transparent bg-transparent text-primary underline-offset-4 [a&]:hover:underline',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Badge({
  className,
  variant,
  render = <span />,
  ...props
}: React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & { render?: useRender.RenderProp }) {
  return useRender({
    render,
    props: {
      'data-slot': 'badge',
      className: cn(badgeVariants({ variant }), className),
      ...props,
    },
  });
}

export { Badge, badgeVariants };
