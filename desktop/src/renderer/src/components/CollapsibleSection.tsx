import { useState, useRef, useEffect } from 'react';

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
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(
    defaultOpen ? undefined : 0,
  );

  useEffect(() => {
    if (!contentRef.current) return;
    if (isOpen) {
      setHeight(contentRef.current.scrollHeight);
      // After transition, set to auto so content can resize
      const timeout = setTimeout(() => setHeight(undefined), 200);
      return () => clearTimeout(timeout);
    } else {
      // First set to current height so transition can animate from it
      setHeight(contentRef.current.scrollHeight);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setHeight(0));
      });
    }
  }, [isOpen]);

  return (
    <div className="border-l-[3px] rounded-sm" style={{ borderColor }}>
      <button
        onClick={() => setIsOpen((prev) => !prev)}
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
      <div
        ref={contentRef}
        className="overflow-hidden transition-[max-height] duration-200 ease-in-out"
        style={{ maxHeight: height === undefined ? 'none' : `${height}px` }}
      >
        <div className="px-3 pb-2">{children}</div>
      </div>
    </div>
  );
}
