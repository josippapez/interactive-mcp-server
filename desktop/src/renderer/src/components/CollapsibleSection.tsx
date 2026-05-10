import { useState } from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from './ui/collapsible';

type Props = {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  borderColor?: string;
};

export default function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
  borderColor = '#445566',
}: Props): React.ReactElement {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="border-l-[3px] rounded-sm" style={{ borderColor }}>
        <CollapsibleTrigger
          render={
            <button
              type="button"
              className="flex items-center gap-1.5 w-full px-3 py-1.5 text-left text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              <span
                className="transition-transform duration-200 text-[10px]"
                style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
              >
                ▶
              </span>
              <span className="truncate">{title}</span>
            </button>
          }
        />
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <div className="px-3 pb-2">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
