import * as React from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';

import { cn } from '@/lib/utils';

/**
 * Internal context shared between PopoverAnchor and PopoverPositioner so a
 * caller-supplied anchor element drives Base UI's positioner without needing
 * to thread refs manually. Base UI's Popover does not ship its own Anchor
 * primitive (only Trigger or an explicit `anchor` prop on the Positioner),
 * so we provide a thin shim.
 */
type PopoverAnchorState = {
  setAnchor: (el: HTMLElement | null) => void;
  anchor: HTMLElement | null;
};

const PopoverAnchorContext = React.createContext<PopoverAnchorState | null>(
  null,
);

function PopoverAnchorProvider({ children }: { children: React.ReactNode }) {
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const value = React.useMemo(() => ({ anchor, setAnchor }), [anchor]);
  return (
    <PopoverAnchorContext.Provider value={value}>
      {children}
    </PopoverAnchorContext.Provider>
  );
}

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return (
    <PopoverAnchorProvider>
      <PopoverPrimitive.Root data-slot="popover" {...props} />
    </PopoverAnchorProvider>
  );
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverPositioner({
  sideOffset = 4,
  portal,
  className,
  anchor: anchorProp,
  ...props
}: PopoverPrimitive.Positioner.Props & {
  portal?: PopoverPrimitive.Portal.Props;
}) {
  const ctx = React.useContext(PopoverAnchorContext);
  // Explicit `anchor` prop wins; otherwise fall back to the element registered
  // via <PopoverAnchor>; otherwise undefined => Base UI uses the Trigger.
  const anchor = anchorProp ?? ctx?.anchor ?? undefined;
  return (
    <PopoverPrimitive.Portal {...portal}>
      <PopoverPrimitive.Positioner
        data-slot="popover-positioner"
        sideOffset={sideOffset}
        className={cn('z-50', className)}
        anchor={anchor}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

function PopoverContent({ className, ...props }: PopoverPrimitive.Popup.Props) {
  return (
    <PopoverPrimitive.Popup
      data-slot="popover-content"
      className={cn(
        'bg-popover text-popover-foreground data-[open]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[open]:fade-in-0 data-[closed]:zoom-out-95 data-[open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border p-4 shadow-md outline-hidden',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Defines the DOM element the popover positions itself against, for popovers
 * that are externally controlled and do not use <PopoverTrigger>.
 *
 * Renders the supplied element via the `render` prop (or a default empty div)
 * and registers its DOM node with the parent <Popover>'s anchor context so
 * <PopoverPositioner> can pass it to Base UI as the `anchor` prop.
 *
 * Important: must be a descendant of <Popover>, NOT inside <PopoverPositioner>
 * (the positioner reads from the same context to find this element).
 */
type PopoverAnchorProps = {
  render?: React.ReactElement<{
    ref?: React.Ref<HTMLElement>;
    [key: string]: unknown;
  }>;
  className?: string;
};

function PopoverAnchor({ render, className }: PopoverAnchorProps) {
  const ctx = React.useContext(PopoverAnchorContext);
  const ref = React.useCallback(
    (el: HTMLElement | null) => {
      ctx?.setAnchor(el);
    },
    [ctx],
  );

  if (render) {
    return React.cloneElement(render, {
      ref,
      'data-slot': 'popover-anchor',
    });
  }
  return (
    <div
      ref={ref}
      data-slot="popover-anchor"
      className={cn('pointer-events-none', className)}
      aria-hidden="true"
    />
  );
}

function PopoverArrow({ ...props }: PopoverPrimitive.Arrow.Props) {
  return <PopoverPrimitive.Arrow data-slot="popover-arrow" {...props} />;
}

function PopoverHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="popover-header"
      className={cn(
        'flex flex-col gap-1 border-b border-border px-3 py-2',
        className,
      )}
      {...props}
    />
  );
}

function PopoverTitle({ className, ...props }: React.ComponentProps<'h4'>) {
  return (
    <h4
      data-slot="popover-title"
      className={cn('text-sm font-semibold leading-none', className)}
      {...props}
    />
  );
}

function PopoverDescription({
  className,
  ...props
}: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="popover-description"
      className={cn('text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
  PopoverArrow,
  PopoverPositioner,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
};
