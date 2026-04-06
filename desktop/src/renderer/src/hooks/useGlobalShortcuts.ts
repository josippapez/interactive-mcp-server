import { useState, useEffect, useRef } from 'react';

type ShortcutCallbacks = {
  onSwitchTab: (tab: 1 | 2) => void;
};

export function useGlobalShortcuts({ onSwitchTab }: ShortcutCallbacks) {
  const [showShortcuts, setShowShortcuts] = useState(false);
  const showRef = useRef(showShortcuts);
  const switchRef = useRef(onSwitchTab);

  useEffect(() => {
    showRef.current = showShortcuts;
  }, [showShortcuts]);

  useEffect(() => {
    switchRef.current = onSwitchTab;
  }, [onSwitchTab]);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === '1') {
        e.preventDefault();
        switchRef.current(1);
        return;
      }
      if (meta && e.key === '2') {
        e.preventDefault();
        switchRef.current(2);
        return;
      }
      if (
        (meta && e.key === '/') ||
        (e.key === '?' &&
          !meta &&
          !(e.target instanceof HTMLTextAreaElement) &&
          !(e.target instanceof HTMLInputElement))
      ) {
        e.preventDefault();
        setShowShortcuts((prev) => !prev);
        return;
      }
      if (e.key === 'Escape' && showRef.current) {
        e.preventDefault();
        setShowShortcuts(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return {
    showShortcuts,
    openShortcuts: () => setShowShortcuts(true),
    closeShortcuts: () => setShowShortcuts(false),
  };
}
